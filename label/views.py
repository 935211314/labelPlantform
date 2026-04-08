# -*- coding: utf-8 -*-
"""
views.py（完整改造版）
改造要点：
1) 统一标注文件解析：resolve_annotation_file() + /label/resolve_annotation/
   - 规则：优先 base.ext -> 再找 base_*.ext(最新) -> 再尝试其他格式 -> 都没有则返回 base.ext 以便新建
   - 目的：前端加载不再“盲猜文件名”，写入与读取绑定同一个真实文件

2) 保存逻辑：
   - save_annotation() 接收前端回传 ann_filename（由解析接口给出），或后端自行解析
   - 三种保存函数增加 override_path，强制写到解析出的路径，杜绝生成 *_随机后缀

3) 统计进度：
   - manage_packages() 对已存在的 .txt/.json/.xml 文件名做“去随机后缀”再比对图片 stem
   - 解决 1358_3TREwQB.txt 与 1358.jpg 对不上导致统计错误的问题
"""

import os
import re  # 新增：识别“_随机后缀”文件名
import glob
import json
import shutil
import zipfile
import xml.etree.ElementTree as ET
from io import BytesIO
from pathlib import Path  # 新增：更安全的路径处理
from collections import defaultdict

from django.conf import settings
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.files.base import ContentFile
from django.http import (
    HttpResponse, JsonResponse,
    HttpResponseForbidden, HttpResponseBadRequest
)
from django.shortcuts import render, redirect, get_object_or_404
from django.urls import reverse
from django.utils.timezone import localtime
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST, require_GET

from user.models import Organization
from user.models import RoleInOrganization  # 你原文件有引用，保留
from .models import TaskPackage, ImageFile, TaskAssignment, QcAssignment
from .forms import TaskPackageForm


# =========================
#  工具：文件名归一化/解析
# =========================

def _norm_stem(filename_or_path: str) -> str:
    """
    把 '1358_3TREwQB' 归一化为 '1358'
    原理：很多数据里为了避免覆盖会在基本名后追加 _短ID；
         我们用正则匹配末尾 “_字母数字或-” 4~12位 的片段并剔除。
    """
    stem = os.path.splitext(os.path.basename(filename_or_path))[0]
    m = re.match(r"^(.+?)_[A-Za-z0-9\-]{4,12}$", stem)
    return m.group(1) if m else stem


def resolve_annotation_file(task_name: str, img_name: str, prefer_format: str):
    """
    解析“该图片应该读取/覆盖”的标注文件。
    返回：(exists, abs_path, rel_url, real_format)

    解析策略（为什么这样写）：
    - 任务包可能自带 txt/json/xml，甚至带随机后缀；前端又可能偏好某种格式。
    - 我们先按“偏好格式”找 base.ext，再找 base_*.ext（取最新），如果没有，再尝试
      其他格式（base 或 base_*）。仍没有，则返回 base.prefer_ext（用于首存）。
    - 好处：读取/写入一致，避免产生新的 *_随机后缀。
    """
    prefer_format = (prefer_format or "json").lower()
    ext_map = {"json": ".json", "xml": ".xml", "txt": ".txt", "yolo": ".txt"}
    prefer_ext = ext_map.get(prefer_format, ".json")

    ann_dir = Path(settings.MEDIA_ROOT) / "annotations" / task_name
    ann_dir.mkdir(parents=True, exist_ok=True)

    base = _norm_stem(Path(img_name).stem)

    # 1) 首选 base.ext
    exact = ann_dir / f"{base}{prefer_ext}"
    if exact.exists():
        rel = f"{settings.MEDIA_URL}annotations/{task_name}/{exact.name}"
        return True, exact, rel, prefer_format

    # 2) 其次 base_*.ext（按最近修改时间倒序选择最新）
    cand = sorted(ann_dir.glob(f"{base}_*{prefer_ext}"),
                  key=lambda p: p.stat().st_mtime, reverse=True)
    if cand:
        chosen = cand[0]
        rel = f"{settings.MEDIA_URL}annotations/{task_name}/{chosen.name}"
        return True, chosen, rel, prefer_format

    # 3) 尝试其他格式（任务包自带格式与偏好不同的情况）
    for fmt, ext in (("json", ".json"), ("xml", ".xml"), ("txt", ".txt")):
        if ext == prefer_ext:
            continue
        exact_alt = ann_dir / f"{base}{ext}"
        if exact_alt.exists():
            rel = f"{settings.MEDIA_URL}annotations/{task_name}/{exact_alt.name}"
            return True, exact_alt, rel, fmt

        cand_alt = sorted(ann_dir.glob(f"{base}_*{ext}"),
                          key=lambda p: p.stat().st_mtime, reverse=True)
        if cand_alt:
            chosen = cand_alt[0]
            rel = f"{settings.MEDIA_URL}annotations/{task_name}/{chosen.name}"
            return True, chosen, rel, fmt

    # 4) 都没有 → 给出未来要写入的规范名 base.prefer_ext
    rel = f"{settings.MEDIA_URL}annotations/{task_name}/{exact.name}"
    return False, exact, rel, prefer_format


# =========================
#   上传任务包（保留原逻辑）
# =========================

@login_required
def upload_task_package(request):
    """
    原理说明：
    - 只允许平台管理员上传；
    - 解压 ZIP 到独立目录；
    - 图片入库（保持原文件名），标注文件原样复制到 annotations/{task_name}/ 下；
    - 不在这里改名，以免破坏甲方/数据方提供的文件结构。
    """
    if not request.user.is_superuser:
        messages.warning(request, "仅平台管理员可以上传任务包")
        return redirect('/')

    if request.method == 'POST':
        form = TaskPackageForm(request.POST, request.FILES)
        if form.is_valid():
            task_package = form.save(commit=False)
            task_package.created_by = request.user
            task_package.save()

            zip_path = task_package.zip_file.path
            extract_dir = os.path.join(settings.MEDIA_ROOT, f'task_packages/{task_package.id}')
            annotation_target_dir = os.path.join(settings.MEDIA_ROOT, "annotations", task_package.name)

            try:
                # 1) 解压
                os.makedirs(extract_dir, exist_ok=True)
                with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                    zip_ref.extractall(extract_dir)

                # 2) 标注目录
                os.makedirs(annotation_target_dir, exist_ok=True)

                # 3) 遍历处理
                for root, dirs, files in os.walk(extract_dir):
                    for filename in files:
                        full_path = os.path.join(root, filename)

                        # 图片：保存到 ImageFile，并保持原始文件名记录
                        if filename.lower().endswith(('.jpg', '.jpeg', '.png')):
                            with open(full_path, 'rb') as f:
                                content = f.read()
                            image_instance = ImageFile(
                                package=task_package,
                                filename=filename  # 记录原始文件名
                            )
                            image_instance.image.save(filename, ContentFile(content))
                            image_instance.save()

                        # 标注：原样复制到 annotations/{task_name}/
                        elif filename.lower().endswith(('.json', '.xml', '.txt')):
                            shutil.copy2(full_path, os.path.join(annotation_target_dir, filename))

                messages.success(request, '任务包上传并解析成功！')
                return redirect('upload_task_package')

            except Exception as e:
                # 失败回滚：数据库记录 + 物理文件
                print(f"[ERROR] 上传失败: {e}")
                task_package.delete()

                if os.path.exists(extract_dir):
                    shutil.rmtree(extract_dir, ignore_errors=True)
                if os.path.exists(annotation_target_dir):
                    shutil.rmtree(annotation_target_dir, ignore_errors=True)
                if os.path.exists(zip_path):
                    os.remove(zip_path)

                messages.error(request, f"上传失败，已回滚：{str(e)}")
                return redirect('upload_task_package')
    else:
        form = TaskPackageForm()

    return render(request, 'label/upload_task_package.html', {'form': form})


# =========================
#   任务包领取/我的任务等
# =========================

@login_required
def available_packages(request):
    user = request.user
    my_assignment = TaskAssignment.objects.filter(user=user, is_completed=False).first()

    packages = TaskPackage.objects.filter(
        allowed_organization=user.organization
    ).exclude(id__in=TaskAssignment.objects.values_list('package_id', flat=True))

    return render(request, 'label/available_packages.html', {
        'packages': packages,
        'my_assignment': my_assignment
    })


@login_required
@require_POST
def claim_package(request, package_id):
    user = request.user

    if TaskAssignment.objects.filter(user=user, is_completed=False).exists():
        messages.warning(request, '您已有未完成的任务包，不能重复领取。')
        return redirect('available_packages')

    package = get_object_or_404(TaskPackage, id=package_id)

    if package.allowed_organization != user.organization:
        return HttpResponseForbidden('您无权限领取该任务包')

    TaskAssignment.objects.create(user=user, package=package)
    messages.success(request, '任务包领取成功！')
    return redirect('my_task_package')


@login_required
def my_task_package(request):
    user = request.user

    assignment = TaskAssignment.objects.filter(user=user, is_completed=False).first()
    completed_assignments = TaskAssignment.objects.filter(user=user, is_completed=True).select_related('package')

    for a in completed_assignments:
        if a.package.qc_status == 'pass':
            a.qc_status = 'pass'
        elif a.package.qc_status == 'fail':
            a.qc_status = 'fail'
        else:
            a.qc_status = 'pending'

    available_packages = TaskPackage.objects.filter(
        allowed_organization=user.organization
    ).exclude(id__in=TaskAssignment.objects.values_list('package_id', flat=True))

    image = None
    if assignment:
        image = ImageFile.objects.filter(package=assignment.package).first()

    return render(request, 'label/my_package.html', {
        'assignment': assignment,
        'completed_assignments': completed_assignments,
        'available_packages': available_packages,
        'image': image
    })


# =========================
#   管理页 + 进度统计修正
# =========================

@login_required
def manage_packages(request):
    """
    原理：统计时对标注文件名做“去随机后缀”归一化，保证与图片 stem 一致。
    例如：1358_3TREwQB.txt -> 1358
    """
    if not request.user.is_superuser:
        return HttpResponseForbidden("仅平台管理员可访问")

    if request.method == 'POST':
        package_id = request.POST.get('package_id')
        org_id = request.POST.get('organization_id')

        pkg = get_object_or_404(TaskPackage, id=package_id)

        if org_id:
            pkg.allowed_organization_id = org_id
        else:
            pkg.allowed_organization = None

        pkg.save()
        messages.success(request, f"任务包「{pkg.name}」已分配给组织")
        return redirect('manage_packages')

    task_packages = TaskPackage.objects.all().select_related('created_by', 'allowed_organization')
    organizations = Organization.objects.all()

    org_id = request.GET.get('org')
    annotation_status_filter = request.GET.get('annotation_status')
    qc_status_filter = request.GET.get('qc_status')
    client_status_filter = request.GET.get('client_status')

    if org_id:
        task_packages = task_packages.filter(allowed_organization_id=org_id)

    assignment_map = defaultdict(list)
    qc_map = defaultdict(list)
    assignment_status_map = {}
    qc_status_map = {}
    qc_finished_time_map = {}

    for a in TaskAssignment.objects.select_related('user'):
        assignment_map[a.package_id].append(a.user.username)
        status = assignment_status_map.get(a.package_id)
        if status != '已完成':
            assignment_status_map[a.package_id] = '已完成' if a.is_completed else '进行中'

    for q in QcAssignment.objects.select_related('user'):
        qc_map[q.package_id].append(q.user.username)
        if q.is_completed:
            qc_status_map[q.package_id] = '已完成'
            qc_finished_time_map[q.package_id] = localtime(q.updated_at).strftime('%Y-%m-%d %H:%M')
        else:
            qc_status_map[q.package_id] = '质检中'

    result_packages = []
    for pkg in task_packages:
        pkg.annotator = ', '.join(assignment_map.get(pkg.id, [])) or '—'
        pkg.qc_user = ', '.join(qc_map.get(pkg.id, [])) or '—'

        total_images = pkg.imagefile_set.count()

        # 关键：统计“去随机后缀”的标注基名集合
        annotation_dir = os.path.join(settings.MEDIA_ROOT, "annotations", pkg.name)
        completed = 0
        if os.path.exists(annotation_dir):
            annotated_files = glob.glob(os.path.join(annotation_dir, "*.json")) \
                             + glob.glob(os.path.join(annotation_dir, "*.xml")) \
                             + glob.glob(os.path.join(annotation_dir, "*.txt"))
            annotated_names = {_norm_stem(f) for f in annotated_files}  # ← 去后缀
            image_names = {os.path.splitext(img.filename)[0] for img in pkg.imagefile_set.all()}
            completed = len(image_names & annotated_names)

        pkg.progress_text = f"{completed}/{total_images}" if total_images else "0/0"
        pkg.annotation_status = assignment_status_map.get(pkg.id, '未开始')
        pkg.qc_status_display = (
            '合格' if pkg.qc_status == 'pass' else
            '不合格' if pkg.qc_status == 'fail' else
            qc_status_map.get(pkg.id, '未开始')
        )
        pkg.qc_finished_time = qc_finished_time_map.get(pkg.id, '—')

        if hasattr(pkg, "client_review_status"):
            if pkg.client_review_status == "pass":
                pkg.client_review_status_display = "通过"
            elif pkg.client_review_status == "fail":
                pkg.client_review_status_display = "未通过"
            else:
                pkg.client_review_status_display = "未开始"
        else:
            pkg.client_review_status_display = "未开始"

        if annotation_status_filter and pkg.annotation_status != annotation_status_filter:
            continue
        if qc_status_filter and pkg.qc_status_display != qc_status_filter:
            continue
        if client_status_filter and pkg.client_review_status_display != client_status_filter:
            continue

        result_packages.append(pkg)

    return render(request, 'label/manage_packages.html', {
        'packages': result_packages,
        'organizations': organizations,
    })


# =========================
#   标注界面/数据注入
# =========================

def label_interface(request, task_id):
    task = get_object_or_404(TaskPackage, id=task_id)
    image_files = task.imagefile_set.all()
    image_urls = [img.image.url for img in image_files]  # 实际可访问的图片 URL（可能含后缀）
    image_names = [img.filename for img in image_files]  # 原始文件名（无后缀，与你的统计完全一致）

    context = {
        "image_urls": json.dumps(image_urls),
        "image_names": json.dumps(image_names),  # ← 传给前端
        "task_id": task.id,
        "task_name": task.name,
    }

    return render(request, "labelweb/labelweb.html", context)


# =========================
#   解析接口（前端先调用）
# =========================

@require_GET
def resolve_annotation(request):
    """
    GET /label/resolve_annotation/?task=xxx&img=1358.jpg&format=json
    返回当前图片应当读取/覆盖的“真实标注文件名”和相对URL。
    """
    task_name = request.GET.get("task") or request.GET.get("task_name")
    img_name = request.GET.get("img") or request.GET.get("img_name")
    fmt = request.GET.get("format") or request.GET.get("save_format") or "json"

    if not task_name or not img_name:
        return JsonResponse({"ok": False, "msg": "missing params: task/img"}, status=400)

    exists, abs_path, rel_url, real_fmt = resolve_annotation_file(task_name, img_name, fmt)
    return JsonResponse({
        "ok": True,
        "exists": exists,
        "rel_path": rel_url,
        "filename": abs_path.name,  # 前端保存时带回 ann_filename 覆盖它
        "format": real_fmt
    })


# =========================
#   标注保存（改造：覆盖解析到的文件）
# =========================

@csrf_exempt
def save_annotation(request):
    """
    POST JSON:
    {
      "task_name": "guanshu_0001",
      "imgName": "1358.jpg",
      "objs": [...],
      "format": "json/xml/txt/yolo",
      "ann_filename": "1358_3TREwQB.txt"  # 可选，若前端已解析出真实文件名
    }
    """
    if request.method != "POST":
        return JsonResponse({"status": "error", "message": "仅支持POST请求"})

    try:
        body = json.loads(request.body)
        task_name = body.get("task_name")
        img_name = body.get("imgName")
        objs = body.get("objs") or []
        prefer_format = body.get("format", "json")
        override_filename = body.get("ann_filename")  # 关键：覆盖指定文件

        if not task_name:
            return JsonResponse({"status": "error", "message": "缺少任务包名称 task_name"})

        if override_filename:
            ann_dir = Path(settings.MEDIA_ROOT) / "annotations" / task_name
            target_path = ann_dir / override_filename
            target_format = prefer_format
        else:
            exists, target_path, _, target_format = resolve_annotation_file(task_name, img_name, prefer_format)

        # 统一写入解析到的“目标文件”
        if target_format == "json":
            save_as_labelme_json(task_name, img_name, objs, override_path=str(target_path))
        elif target_format == "xml":
            save_as_pascal_voc_xml(task_name, img_name, objs, override_path=str(target_path))
        elif target_format in ("yolo", "txt"):
            save_as_yolo_or_custom_txt(task_name, img_name, objs, prefer=target_format, override_path=str(target_path))
        else:
            return JsonResponse({"status": "error", "message": f"未知保存格式: {target_format}"})

        return JsonResponse({"status": "success", "filename": target_path.name})
    except Exception as e:
        return JsonResponse({"status": "error", "message": str(e)})


# =========================
#   标注页面（含标签库注入）
# =========================

def annotate_view(request, task_id):
    from user.models import ClientTaskAccess

    task = get_object_or_404(TaskPackage, id=task_id)
    image_urls = [img.image.url for img in task.imagefile_set.all()]
    save_format = task.save_format
    labels = task.get_label_list()

    user = request.user

    mode = request.GET.get("mode", "annotate")
    is_qc_mode = (mode == "qc")

    # 甲方账号鉴权
    if user.is_client:
        allowed = ClientTaskAccess.objects.filter(client=user, task_package=task).exists()
        if not allowed:
            return HttpResponseForbidden("你没有权限查看此任务包")

    # 解析标签库文件
    extra_labels = []
    if task.label_file:
        try:
            with open(task.label_file.path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    if "labels" in data:
                        extra_labels = data["labels"]
                    elif "type" in data:  # 兼容你的格式
                        extra_labels = data["type"]
                elif isinstance(data, list):
                    extra_labels = data
        except Exception as e:
            print("⚠️ 标签库解析失败:", e)

    return render(request, 'labelweb/labelweb.html', {
        'task_name': task.name,
        'task_id': task.id,
        'image_urls': json.dumps(image_urls or []),
        'labels': json.dumps(labels or []),
        'extra_labels': json.dumps(extra_labels, ensure_ascii=False),
        'save_format': save_format,
        'is_qc_mode': is_qc_mode,
        'is_client': user.is_client,
    })


# =========================
#   三种保存格式（增加 override_path）
# =========================

def polygon_to_bbox(points):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def save_as_labelme_json(task_name, img_name, objs, override_path=None):
    """
    原理：LabelMe JSON，shapes 内按 rectangle/polygon 写入；
    这里不关心历史文件名，只写到 override_path（若提供）或 base.json。
    """
    data = {
        "version": "5.0.1",
        "flags": {},
        "shapes": [],
        "imagePath": img_name,
        "imageData": None,
        "imageHeight": 0,
        "imageWidth": 0,
    }

    for obj in objs:
        shape_type = obj.get("shape_type", "rectangle")
        if shape_type == "polygon":
            shape = {
                "label": obj["label"],
                "points": obj["points"],
                "group_id": None,
                "shape_type": "polygon",
                "flags": {}
            }
        else:
            shape = {
                "label": obj["label"],
                "points": [
                    [obj["xmin"], obj["ymin"]],
                    [obj["xmax"], obj["ymax"]]
                ],
                "group_id": None,
                "shape_type": "rectangle",
                "flags": {}
            }
        if obj.get("error_note"):
            shape["error_note"] = obj["error_note"]
        data["shapes"].append(shape)

    path = Path(settings.MEDIA_ROOT) / "annotations" / task_name
    path.mkdir(parents=True, exist_ok=True)
    json_path = Path(override_path) if override_path else (
            path / f"{_norm_stem(Path(img_name).stem)}.json"  # ← 使用规范化基名
    )

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def save_as_pascal_voc_xml(task_name, img_name, objs, override_path=None):
    """
    原理：标准 PASCAL VOC XML；polygon 按 bbox 落盘；
    允许 error_note 自定义扩展标签。
    """
    root = ET.Element("annotation")
    ET.SubElement(root, "folder").text = task_name
    ET.SubElement(root, "filename").text = img_name

    size = ET.SubElement(root, "size")
    ET.SubElement(size, "width").text = "0"
    ET.SubElement(size, "height").text = "0"
    ET.SubElement(size, "depth").text = "3"

    for obj in objs:
        if obj.get("shape_type") == "polygon":
            xmin, ymin, xmax, ymax = polygon_to_bbox(obj["points"])
        else:
            xmin, ymin, xmax, ymax = obj["xmin"], obj["ymin"], obj["xmax"], obj["ymax"]

        object_el = ET.SubElement(root, "object")
        ET.SubElement(object_el, "name").text = obj["label"]
        ET.SubElement(object_el, "pose").text = "Unspecified"
        ET.SubElement(object_el, "truncated").text = "0"
        ET.SubElement(object_el, "difficult").text = "0"

        bbox = ET.SubElement(object_el, "bndbox")
        ET.SubElement(bbox, "xmin").text = str(int(xmin))
        ET.SubElement(bbox, "ymin").text = str(int(ymin))
        ET.SubElement(bbox, "xmax").text = str(int(xmax))
        ET.SubElement(bbox, "ymax").text = str(int(ymax))

        if obj.get("error_note"):
            ET.SubElement(object_el, "error_note").text = obj["error_note"]

    path = Path(settings.MEDIA_ROOT) / "annotations" / task_name
    path.mkdir(parents=True, exist_ok=True)
    xml_path = Path(override_path) if override_path else (
            path / f"{_norm_stem(Path(img_name).stem)}.xml"  # ← 使用规范化基名
    )

    tree = ET.ElementTree(root)
    tree.write(xml_path, encoding="utf-8", xml_declaration=True)


def save_as_yolo_or_custom_txt(task_name, img_name, objs, prefer="txt", override_path=None, image_width=1, image_height=1):
    """
    合并 YOLO / 自定义 TXT 的写入，便于共用 override_path。
    prefer: 'yolo' 或 'txt'
    """
    if prefer == "yolo":
        lines = []
        for obj in objs:
            if obj.get("shape_type") == "polygon":
                xmin, ymin, xmax, ymax = polygon_to_bbox(obj["points"])
            else:
                xmin, ymin, xmax, ymax = obj["xmin"], obj["ymin"], obj["xmax"], obj["ymax"]

            class_id = 0  # TODO：按你的 label→id 映射填充
            x_center = (xmin + xmax) / 2 / image_width
            y_center = (ymin + ymax) / 2 / image_height
            width = (xmax - xmin) / image_width
            height = (ymax - ymin) / image_height

            line = f"{class_id} {x_center:.6f} {y_center:.6f} {width:.6f} {height:.6f}"
            if obj.get("error_note"):
                line += f"  # {obj['error_note']}"
            lines.append(line)
        content = "\n".join(lines)
    else:
        rows = []
        for obj in objs:
            if obj.get("shape_type") == "polygon":
                xmin, ymin, xmax, ymax = polygon_to_bbox(obj["points"])
            else:
                xmin, ymin, xmax, ymax = obj["xmin"], obj["ymin"], obj["xmax"], obj["ymax"]
            parts = [str(img_name), str(int(xmin)), str(int(ymin)), str(int(xmax)), str(int(ymax)), obj["label"]]
            if obj.get("error_note"):
                parts.append(f"error_note={obj['error_note']}")
            rows.append(";".join(parts))
        content = "\n".join(rows)

    path = Path(settings.MEDIA_ROOT) / "annotations" / task_name
    path.mkdir(parents=True, exist_ok=True)
    txt_path = Path(override_path) if override_path else (
            path / f"{_norm_stem(Path(img_name).stem)}.txt"  # ← 使用规范化基名
    )

    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(content)


# 为兼容你之前单独的函数名，保留两个薄封装（可选）
def save_as_yolo_txt(task_name, img_name, objs, image_width=1, image_height=1, override_path=None):
    return save_as_yolo_or_custom_txt(
        task_name, img_name, objs, prefer="yolo",
        override_path=override_path, image_width=image_width, image_height=image_height
    )


def save_as_custom_txt(task_name, img_name, objs, override_path=None):
    return save_as_yolo_or_custom_txt(
        task_name, img_name, objs, prefer="txt", override_path=override_path
    )


# =========================
#   任务完成/质检/下载等
# =========================

@csrf_exempt
@require_POST
def mark_task_done(request, task_id):
    try:
        user = request.user
        assignment = TaskAssignment.objects.get(user=user, package_id=task_id)
        if assignment.is_completed:
            return JsonResponse({'success': False, 'message': '任务包已提交'})

        assignment.is_completed = True
        assignment.save()
        return JsonResponse({'success': True})
    except TaskAssignment.DoesNotExist:
        return JsonResponse({'success': False, 'message': '未找到任务包记录'})
    except Exception as e:
        return JsonResponse({'success': False, 'message': str(e)})


@login_required
def available_qc_packages(request):
    user = request.user
    org = getattr(user, 'organization', None)
    if not org:
        return HttpResponseForbidden("未加入任何组织，无法领取质检任务。")

    current_assignment = QcAssignment.objects.filter(
        user=user, is_completed=False
    ).select_related('package').first()

    completed_assignments = QcAssignment.objects.filter(
        user=user, is_completed=True
    ).select_related('package')

    for qc in completed_assignments:
        status = qc.package.client_review_status
        qc.client_review_display = (
            "通过" if status == "pass" else
            "未通过" if status == "fail" else
            "未开始"
        )

    completed_packages = TaskAssignment.objects.filter(
        is_completed=True,
        package__allowed_organization=org
    ).values_list('package_id', flat=True)

    qc_claimed = QcAssignment.objects.values_list('package_id', flat=True)

    available_packages = TaskPackage.objects.filter(
        id__in=completed_packages
    ).exclude(id__in=qc_claimed)

    return render(request, 'label/available_qc_packages.html', {
        'current_assignment': current_assignment,
        'completed_assignments': completed_assignments,
        'available_packages': available_packages,
    })


@login_required
@require_POST
def claim_qc_package(request, package_id):
    user = request.user
    package = get_object_or_404(TaskPackage, id=package_id)

    if QcAssignment.objects.filter(user=user, is_completed=False).exists():
        return HttpResponseForbidden("你已有未完成的质检任务。")

    QcAssignment.objects.create(user=user, package=package)
    url = reverse('label_interface', kwargs={'task_id': package.id})
    return redirect(f"{url}?mode=qc")


@csrf_exempt
def submit_qc_result(request, task_id):
    if request.method == 'POST':
        data = json.loads(request.body)
        result = data.get('result')  # 'pass' or 'fail'
        try:
            task = TaskPackage.objects.get(id=task_id)
            task.qc_status = result
            task.save()

            qc_assignment = QcAssignment.objects.get(user=request.user, package=task)
            qc_assignment.is_completed = True
            qc_assignment.save()

            return JsonResponse({'status': 'success', 'message': '已提交质检结果'})
        except TaskPackage.DoesNotExist:
            return JsonResponse({'status': 'error', 'message': '任务不存在'}, status=404)
        except QcAssignment.DoesNotExist:
            return JsonResponse({'status': 'error', 'message': '质检记录不存在'}, status=404)

    return JsonResponse({'status': 'error', 'message': '仅支持 POST'}, status=400)


@login_required
def download_package(request, package_id):
    if not request.user.is_superuser:
        return HttpResponseForbidden("无权限")

    pkg = get_object_or_404(TaskPackage, id=package_id)

    buffer = BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        # 1) 图片
        for img in pkg.imagefile_set.all():
            img_path = img.image.path
            zip_file.write(img_path, arcname=f"images/{img.filename}")

        # 2) 标注（保持原名，包含可能的 _随机后缀）
        annotation_dir = os.path.join(settings.MEDIA_ROOT, "annotations", pkg.name)
        if os.path.exists(annotation_dir):
            for root, dirs, files in os.walk(annotation_dir):
                for filename in files:
                    file_path = os.path.join(root, filename)
                    rel_path = os.path.relpath(file_path, annotation_dir)
                    zip_file.write(file_path, arcname=f"annotations/{rel_path}")

    buffer.seek(0)
    response = HttpResponse(buffer, content_type='application/zip')
    response['Content-Disposition'] = f'attachment; filename="{pkg.name}.zip"'
    return response


@csrf_exempt
@login_required
def submit_client_review(request, task_id):
    if request.method == 'POST':
        user = request.user
        if not user.is_client:
            return JsonResponse({'status': 'error', 'message': '只有甲方账号可以提交'}, status=403)

        data = json.loads(request.body)
        result = data.get('result')  # "pass" or "fail"

        try:
            task = TaskPackage.objects.get(id=task_id)
            if result in ['pass', 'fail']:
                task.client_review_status = result
                task.save()

            return JsonResponse({'status': 'success', 'message': f'已提交：{result}'})
        except TaskPackage.DoesNotExist:
            return JsonResponse({'status': 'error', 'message': '任务不存在'}, status=404)

    return JsonResponse({'status': 'error', 'message': '仅支持 POST'}, status=400)


@login_required
@require_POST
def delete_package(request, package_id):
    if not request.user.is_superuser:
        return JsonResponse({"success": False, "message": "仅平台管理员可删除任务包"}, status=403)

    pkg = get_object_or_404(TaskPackage, id=package_id)

    extract_dir = os.path.join(settings.MEDIA_ROOT, f"task_packages/{pkg.id}")
    annotation_dir = os.path.join(settings.MEDIA_ROOT, "annotations", pkg.name)

    pkg.imagefile_set.all().delete()
    TaskAssignment.objects.filter(package=pkg).delete()
    QcAssignment.objects.filter(package=pkg).delete()
    pkg.delete()

    if os.path.exists(extract_dir):
        shutil.rmtree(extract_dir, ignore_errors=True)
    if os.path.exists(annotation_dir):
        shutil.rmtree(annotation_dir, ignore_errors=True)

    return JsonResponse({"success": True, "message": "任务包已删除"})
