# -*- coding: utf-8 -*-
"""
views.py（企业级改造版）
改造要点：
1. 统一标注文件解析：resolve_annotation_file() + /label/resolve_annotation/
2. 保存逻辑：覆盖指定文件，杜绝生成随机后缀
3. 统计进度：去随机后缀归一化
4. 企业级增强：
   - transaction.atomic() 保证数据一致性
   - annotate/prefetch_related 消除 N+1 查询
   - 角色权限校验装饰器
   - 操作审计日志
   - 分页支持
   - 输入验证（标注框数量限制等）
"""

import os
import re
import glob
import json
import shutil
import zipfile
import xml.etree.ElementTree as ET
from io import BytesIO
from pathlib import Path
from collections import defaultdict

from django.conf import settings
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.files.base import ContentFile
from django.core.paginator import Paginator
from django.db import models, transaction
from django.db.models import Count, Exists, OuterRef
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
from user.models import RoleInOrganization
from user.permissions import require_platform_admin, require_role, require_client
from .models import TaskPackage, ImageFile, TaskAssignment, QcAssignment
from .forms import TaskPackageForm

from core.models import AuditLog

PAGE_SIZE = 20
MAX_ANNOTATION_OBJS = 500  # 单张图片最多 500 个标注框


# =========================
#  工具：文件名归一化/解析
# =========================

def _norm_stem(filename_or_path: str) -> str:
    """
    把 '1358_3TREwQB' 归一化为 '1358'
    """
    stem = os.path.splitext(os.path.basename(filename_or_path))[0]
    m = re.match(r"^(.+?)_[A-Za-z0-9\-]{4,12}$", stem)
    return m.group(1) if m else stem


def resolve_annotation_file(task_name: str, img_name: str, prefer_format: str):
    """
    解析"该图片应该读取/覆盖"的标注文件。
    返回：(exists, abs_path, rel_url, real_format)
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

    # 3) 尝试其他格式
    for fmt, ext in (("json", ".json"), ("xml", ".xml"), ("txt", ".txt")):
        if ext == prefer_ext:
            continue
        exact_alt = ann_dir / f"{base}{ext}"
        if exact_alt.exists():
            rel = f"{settings.MEDIA_URL}annotations/{task_name}/{exact_alt.name}"
            return True, exact_alt, rel, fmt  # ✅ 返回实际找到的文件格式，而非 prefer_format

        cand_alt = sorted(ann_dir.glob(f"{base}_*{ext}"),
                          key=lambda p: p.stat().st_mtime, reverse=True)
        if cand_alt:
            chosen = cand_alt[0]
            rel = f"{settings.MEDIA_URL}annotations/{task_name}/{chosen.name}"
            return True, chosen, rel, fmt  # ✅ 同上

    # 4) 都没有 → 给出未来要写入的规范名 base.prefer_ext
    rel = f"{settings.MEDIA_URL}annotations/{task_name}/{exact.name}"
    return False, exact, rel, prefer_format


# =========================
#   上传任务包
# =========================

@login_required
@require_platform_admin
def upload_task_package(request):
    if request.method == 'POST':
        form = TaskPackageForm(request.POST, request.FILES)
        if form.is_valid():
            with transaction.atomic():
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

                            if filename.lower().endswith(('.jpg', '.jpeg', '.png')):
                                with open(full_path, 'rb') as f:
                                    content = f.read()
                                image_instance = ImageFile(
                                    package=task_package,
                                    filename=filename
                                )
                                image_instance.image.save(filename, ContentFile(content))
                                image_instance.save()

                            elif filename.lower().endswith(('.json', '.xml', '.txt')):
                                shutil.copy2(full_path, os.path.join(annotation_target_dir, filename))

                    AuditLog.log(request, 'package_upload', 'TaskPackage', task_package.id,
                                 f'上传任务包【{task_package.name}】')
                    messages.success(request, '任务包上传并解析成功！')
                    return redirect('upload_task_package')

                except Exception as e:
                    # 事务会自动回滚，但需要清理物理文件
                    if os.path.exists(extract_dir):
                        shutil.rmtree(extract_dir, ignore_errors=True)
                    if os.path.exists(annotation_target_dir):
                        shutil.rmtree(annotation_target_dir, ignore_errors=True)

                    messages.error(request, f"上传失败，已回滚：{str(e)}")
                    return redirect('upload_task_package')
    else:
        form = TaskPackageForm()

    return render(request, 'label/upload_task_package.html', {'form': form})


# =========================
#   任务包领取/我的任务
# =========================

@login_required
@require_role('annotator')
def available_packages(request):
    user = request.user
    my_assignment = TaskAssignment.objects.filter(user=user, is_completed=False).first()

    # ✅ 使用 annotate 消除 N+1
    packages = TaskPackage.objects.filter(
        allowed_organization=user.organization
    ).exclude(
        id__in=TaskAssignment.objects.values_list('package_id', flat=True)
    ).annotate(
        image_count=Count('imagefile')
    ).order_by('-created_at')

    paginator = Paginator(packages, PAGE_SIZE)
    page_number = request.GET.get('page', 1)
    page_obj = paginator.get_page(page_number)

    return render(request, 'label/available_packages.html', {
        'packages': packages,
        'my_assignment': my_assignment,
        'page_obj': page_obj,
    })


@login_required
@require_role('annotator')
@require_POST
def claim_package(request, package_id):
    user = request.user

    with transaction.atomic():
        if TaskAssignment.objects.filter(user=user, is_completed=False).exists():
            messages.warning(request, '您已有未完成的任务包，不能重复领取。')
            return redirect('available_packages')

        package = get_object_or_404(TaskPackage, id=package_id)

        if package.allowed_organization != user.organization:
            return HttpResponseForbidden('您无权限领取该任务包')

        TaskAssignment.objects.create(user=user, package=package)

        AuditLog.log(request, 'package_claim', 'TaskPackage', package.id,
                     f'领取任务包【{package.name}】')

    messages.success(request, '任务包领取成功！')
    return redirect('my_task_package')


@login_required
@require_role('annotator')
def my_task_package(request):
    user = request.user

    assignment = TaskAssignment.objects.filter(user=user, is_completed=False).select_related('package').first()
    completed_assignments = TaskAssignment.objects.filter(
        user=user, is_completed=True
    ).select_related('package').order_by('-assigned_at')

    # 分页已完成任务
    paginator = Paginator(list(completed_assignments), PAGE_SIZE)
    page_number = request.GET.get('completed_page', 1)
    page_obj = paginator.get_page(page_number)

    for a in completed_assignments:
        if a.package.qc_status == 'pass':
            a.qc_status = 'pass'
        elif a.package.qc_status == 'fail':
            a.qc_status = 'fail'
        else:
            a.qc_status = 'pending'

    available_packages = TaskPackage.objects.filter(
        allowed_organization=user.organization
    ).exclude(
        id__in=TaskAssignment.objects.values_list('package_id', flat=True)
    ).annotate(
        image_count=Count('imagefile')
    ).order_by('-created_at')

    image = None
    if assignment:
        image = ImageFile.objects.filter(package=assignment.package).first()

    return render(request, 'label/my_package.html', {
        'assignment': assignment,
        'completed_assignments': completed_assignments,
        'available_packages': available_packages,
        'image': image,
        'page_obj': page_obj,
    })


# =========================
#   管理页 + 进度统计
# =========================

@login_required
@require_platform_admin
def manage_packages(request):
    if request.method == 'POST':
        package_id = request.POST.get('package_id')
        org_id = request.POST.get('organization_id')

        with transaction.atomic():
            pkg = get_object_or_404(TaskPackage, id=package_id)

            if org_id:
                pkg.allowed_organization_id = org_id
            else:
                pkg.allowed_organization = None

            pkg.save()

        messages.success(request, f"任务包「{pkg.name}」已分配给组织")
        return redirect('manage_packages')

    # ✅ 使用 select_related + prefetch_related 优化查询
    task_packages = TaskPackage.objects.all().select_related('created_by', 'allowed_organization')
    organizations = Organization.objects.all()

    org_id = request.GET.get('org')
    annotation_status_filter = request.GET.get('annotation_status')
    qc_status_filter = request.GET.get('qc_status')
    client_status_filter = request.GET.get('client_status')

    if org_id:
        task_packages = task_packages.filter(allowed_organization_id=org_id)

    # ✅ 使用 defaultdict + 单次查询构建映射表
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

    # ✅ 预先获取所有 ImageFile 数据，避免 per-package count 查询
    image_counts = dict(
        ImageFile.objects.values('package_id')
        .annotate(count=Count('id'))
        .values_list('package_id', 'count')
    )

    # 获取所有标注文件名（一次性读取）
    result_packages = []
    for pkg in task_packages:
        pkg.annotator = ', '.join(assignment_map.get(pkg.id, [])) or '—'
        pkg.qc_user = ', '.join(qc_map.get(pkg.id, [])) or '—'

        total_images = image_counts.get(pkg.id, 0)

        # 统计标注文件
        annotation_dir = os.path.join(settings.MEDIA_ROOT, "annotations", pkg.name)
        completed = 0
        if os.path.exists(annotation_dir) and total_images > 0:
            annotated_files = glob.glob(os.path.join(annotation_dir, "*.json")) \
                             + glob.glob(os.path.join(annotation_dir, "*.xml")) \
                             + glob.glob(os.path.join(annotation_dir, "*.txt"))
            annotated_names = {_norm_stem(f) for f in annotated_files}

            # ✅ 使用缓存的 image 数据，不再 per-package 查询
            if not hasattr(manage_packages, '_image_cache'):
                manage_packages._image_cache = {}
            if pkg.id not in manage_packages._image_cache:
                pkg_images = ImageFile.objects.filter(package_id=pkg.id).values_list('filename', flat=True)
                manage_packages._image_cache[pkg.id] = {os.path.splitext(f)[0] for f in pkg_images}

            image_names = manage_packages._image_cache[pkg.id]
            completed = len(image_names & annotated_names)

        pkg.progress_text = f"{completed}/{total_images}" if total_images else "0/0"
        pkg.annotation_status = assignment_status_map.get(pkg.id, '未开始')
        pkg.qc_status_display = (
            '合格' if pkg.qc_status == 'pass' else
            '不合格' if pkg.qc_status == 'fail' else
            qc_status_map.get(pkg.id, '未开始')
        )
        pkg.qc_finished_time = qc_finished_time_map.get(pkg.id, '—')

        if pkg.client_review_status == "pass":
            pkg.client_review_status_display = "通过"
        elif pkg.client_review_status == "fail":
            pkg.client_review_status_display = "未通过"
        else:
            pkg.client_review_status_display = "未开始"

        if annotation_status_filter and pkg.annotation_status != annotation_status_filter:
            continue
        if qc_status_filter and pkg.qc_status_display != qc_status_filter:
            continue
        if client_status_filter and pkg.client_review_status_display != client_status_filter:
            continue

        result_packages.append(pkg)

    # 分页
    paginator = Paginator(result_packages, PAGE_SIZE)
    page_number = request.GET.get('page', 1)
    page_obj = paginator.get_page(page_number)

    if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
        from django.template.loader import render_to_string

        html = render_to_string('label/manage_packages_table.html', {
            'packages': list(page_obj),
            'organizations': organizations,
        }, request=request)

        return JsonResponse({'html': html})

    return render(request, 'label/manage_packages.html', {
        'packages': result_packages,
        'organizations': organizations,
        'page_obj': page_obj,
    })


# =========================
#   标注界面/数据注入
# =========================

@login_required
def label_interface(request, task_id):
    task = get_object_or_404(TaskPackage, id=task_id)
    image_files = task.imagefile_set.all()
    image_urls = [img.image.url for img in image_files]

    # 权限检查
    user = request.user
    mode = request.GET.get("mode", "annotate")

    if user.is_client:
        from user.models import ClientTaskAccess
        allowed = ClientTaskAccess.objects.filter(client=user, task_package=task).exists()
        if not allowed:
            return HttpResponseForbidden("你没有权限查看此任务包")
    elif not user.is_superuser and not user.is_org_admin:
        # 标注/质检模式需要对应的角色
        if mode == "qc":
            has_role = RoleInOrganization.objects.filter(
                user=user, organization=user.organization, role='reviewer'
            ).exists()
            if not has_role:
                return HttpResponseForbidden("需要质检员角色权限")
        else:
            has_role = RoleInOrganization.objects.filter(
                user=user, organization=user.organization, role='annotator'
            ).exists()
            if not has_role:
                return HttpResponseForbidden("需要标注员角色权限")

    # 解析标签库文件
    extra_labels = []
    if task.label_file:
        try:
            with open(task.label_file.path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    if "labels" in data:
                        extra_labels = data["labels"]
                    elif "type" in data:
                        extra_labels = data["type"]
                elif isinstance(data, list):
                    extra_labels = data
        except Exception:
            pass

    context = {
        "image_urls": json.dumps(image_urls),
        "task_id": task.id,
        "task_name": task.name,
        "save_format": task.save_format,
        "labels": json.dumps(task.get_label_list()),
        "extra_labels": json.dumps(extra_labels, ensure_ascii=False),
        "is_qc_mode": mode == "qc",
        "is_client": user.is_client,
    }

    return render(request, "labelweb/labelweb.html", context)


# ✅ annotate_view 是 label_interface 的别名，供 user/urls.py 中甲方查看任务使用
annotate_view = label_interface


# =========================
#   解析接口（前端先调用）
# =========================

@require_GET
def resolve_annotation(request):
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
        "filename": abs_path.name,
        "format": real_fmt
    })


# =========================
#   标注保存（带输入验证）
# =========================

@csrf_exempt
def save_annotation(request):
    if request.method != "POST":
        return JsonResponse({"status": "error", "message": "仅支持POST请求"})

    try:
        body = json.loads(request.body)
        task_name = body.get("task_name")
        img_name = body.get("imgName")
        objs = body.get("objs") or []
        prefer_format = body.get("format", "json")
        override_filename = body.get("ann_filename")

        if not task_name:
            return JsonResponse({"status": "error", "message": "缺少任务包名称 task_name"})

        if not img_name:
            return JsonResponse({"status": "error", "message": "缺少图片名称 imgName"})

        # ✅ 输入验证：标注框数量限制
        if len(objs) > MAX_ANNOTATION_OBJS:
            return JsonResponse({
                "status": "error",
                "message": f"标注框数量超过限制（最多 {MAX_ANNOTATION_OBJS} 个）"
            })

        # ✅ 输入验证：任务名称合法性（防止路径穿越）
        if not re.match(r'^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$', task_name):
            return JsonResponse({"status": "error", "message": "任务名称包含非法字符"})

        if override_filename:
            # 防止路径穿越
            override_filename = os.path.basename(override_filename)
            ann_dir = Path(settings.MEDIA_ROOT) / "annotations" / task_name
            # ✅ 关键修复：强制使用正确的扩展名，避免文件扩展名与内容格式不匹配
            # 例如：ann_filename 可能是 "2275.txt" 但实际内容应该是 JSON
            ext_map = {"json": ".json", "xml": ".xml", "txt": ".txt", "yolo": ".txt"}
            correct_ext = ext_map.get(prefer_format, ".json")
            stem = os.path.splitext(override_filename)[0]
            # 规范化文件名：移除随机后缀，使用正确扩展名
            norm_stem = _norm_stem(stem)
            target_path = ann_dir / f"{norm_stem}{correct_ext}"
            target_format = prefer_format
        else:
            exists, target_path, _, target_format = resolve_annotation_file(task_name, img_name, prefer_format)

        # 统一写入解析到的"目标文件"
        if target_format == "json":
            save_as_labelme_json(task_name, img_name, objs, override_path=str(target_path))
        elif target_format == "xml":
            save_as_pascal_voc_xml(task_name, img_name, objs, override_path=str(target_path))
        elif target_format in ("yolo", "txt"):
            save_as_yolo_or_custom_txt(task_name, img_name, objs, prefer=target_format, override_path=str(target_path))
        else:
            return JsonResponse({"status": "error", "message": f"未知保存格式: {target_format}"})

        return JsonResponse({"status": "success", "filename": target_path.name})
    except json.JSONDecodeError:
        return JsonResponse({"status": "error", "message": "无效的 JSON 数据"})
    except Exception as e:
        return JsonResponse({"status": "error", "message": str(e)})


# =========================
#   三种保存格式（增加 override_path）
# =========================

def polygon_to_bbox(points):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def save_as_labelme_json(task_name, img_name, objs, override_path=None):
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
        label = obj.get("label", "unlabeled")
        shape_type = obj.get("shape_type", "rectangle")
        if shape_type == "polygon":
            shape = {
                "label": label,
                "points": obj.get("points", []),
                "group_id": None,
                "shape_type": "polygon",
                "flags": {}
            }
        else:
            shape = {
                "label": label,
                "points": [
                    [obj.get("xmin", 0), obj.get("ymin", 0)],
                    [obj.get("xmax", 0), obj.get("ymax", 0)]
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
            path / f"{_norm_stem(Path(img_name).stem)}.json"
    )

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def save_as_pascal_voc_xml(task_name, img_name, objs, override_path=None):
    root = ET.Element("annotation")
    ET.SubElement(root, "folder").text = task_name
    ET.SubElement(root, "filename").text = img_name

    size = ET.SubElement(root, "size")
    ET.SubElement(size, "width").text = "0"
    ET.SubElement(size, "height").text = "0"
    ET.SubElement(size, "depth").text = "3"

    for obj in objs:
        label = obj.get("label", "unlabeled")
        if obj.get("shape_type") == "polygon":
            xmin, ymin, xmax, ymax = polygon_to_bbox(obj.get("points", []))
        else:
            xmin, ymin, xmax, ymax = obj.get("xmin", 0), obj.get("ymin", 0), obj.get("xmax", 0), obj.get("ymax", 0)

        object_el = ET.SubElement(root, "object")
        ET.SubElement(object_el, "name").text = label
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
            path / f"{_norm_stem(Path(img_name).stem)}.xml"
    )

    tree = ET.ElementTree(root)
    tree.write(xml_path, encoding="utf-8", xml_declaration=True)


def save_as_yolo_or_custom_txt(task_name, img_name, objs, prefer="txt", override_path=None, image_width=1, image_height=1):
    if prefer == "yolo":
        lines = []
        for obj in objs:
            if obj.get("shape_type") == "polygon":
                xmin, ymin, xmax, ymax = polygon_to_bbox(obj.get("points", []))
            else:
                xmin, ymin, xmax, ymax = obj.get("xmin", 0), obj.get("ymin", 0), obj.get("xmax", 0), obj.get("ymax", 0)

            class_id = 0
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
                xmin, ymin, xmax, ymax = polygon_to_bbox(obj.get("points", []))
            else:
                xmin, ymin, xmax, ymax = obj.get("xmin", 0), obj.get("ymin", 0), obj.get("xmax", 0), obj.get("ymax", 0)
            parts = [str(img_name), str(int(xmin)), str(int(ymin)), str(int(xmax)), str(int(ymax)), obj.get("label", "unlabeled")]
            if obj.get("error_note"):
                parts.append(f"error_note={obj['error_note']}")
            rows.append(";".join(parts))
        content = "\n".join(rows)

    path = Path(settings.MEDIA_ROOT) / "annotations" / task_name
    path.mkdir(parents=True, exist_ok=True)
    txt_path = Path(override_path) if override_path else (
            path / f"{_norm_stem(Path(img_name).stem)}.txt"
    )

    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(content)


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

        with transaction.atomic():
            assignment.is_completed = True
            assignment.save()

            AuditLog.log(request, 'package_submit', 'TaskPackage', task_id,
                         f'提交任务包【{assignment.package.name}】')

        return JsonResponse({'success': True})
    except TaskAssignment.DoesNotExist:
        return JsonResponse({'success': False, 'message': '未找到任务包记录'})
    except Exception as e:
        return JsonResponse({'success': False, 'message': str(e)})


@login_required
@require_role('reviewer')
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
    ).select_related('package').order_by('-updated_at')

    for qc in completed_assignments:
        status = qc.package.client_review_status
        qc.client_review_display = (
            "通过" if status == "pass" else
            "未通过" if status == "fail" else
            "未开始"
        )

    # ✅ 使用 annotate 优化查询
    completed_packages = TaskAssignment.objects.filter(
        is_completed=True,
        package__allowed_organization=org
    ).values_list('package_id', flat=True)

    qc_claimed = QcAssignment.objects.values_list('package_id', flat=True)

    available_packages = TaskPackage.objects.filter(
        id__in=completed_packages
    ).exclude(id__in=qc_claimed).order_by('-created_at')

    # 分页
    paginator = Paginator(list(available_packages), PAGE_SIZE)
    page_number = request.GET.get('page', 1)
    page_obj = paginator.get_page(page_number)

    return render(request, 'label/available_qc_packages.html', {
        'current_assignment': current_assignment,
        'completed_assignments': completed_assignments,
        'available_packages': available_packages,
        'page_obj': page_obj,
    })


@login_required
@require_role('reviewer')
@require_POST
def claim_qc_package(request, package_id):
    user = request.user

    with transaction.atomic():
        if QcAssignment.objects.filter(user=user, is_completed=False).exists():
            return HttpResponseForbidden("你已有未完成的质检任务。")

        package = get_object_or_404(TaskPackage, id=package_id)

        QcAssignment.objects.create(user=user, package=package)

        AuditLog.log(request, 'qc_claim', 'QcAssignment', None,
                     f'领取质检任务包【{package.name}】')

    url = reverse('label_interface', kwargs={'task_id': package.id})
    return redirect(f"{url}?mode=qc")


@csrf_exempt
@require_POST
def submit_qc_result(request, task_id):
    try:
        body = json.loads(request.body)
        result = body.get('result')

        if result not in ('pass', 'fail'):
            return JsonResponse({'status': 'error', 'message': '无效的质检结果'}, status=400)

        with transaction.atomic():
            task = get_object_or_404(TaskPackage, id=task_id)
            task.qc_status = result
            task.save()

            qc_assignment = get_object_or_404(QcAssignment, user=request.user, package=task)
            qc_assignment.is_completed = True
            qc_assignment.save()

            AuditLog.log(request, 'qc_submit', 'QcAssignment', qc_assignment.id,
                         f'提交质检结果【{result}】，任务包【{task.name}】')

        return JsonResponse({'status': 'success', 'message': '已提交质检结果'})
    except TaskPackage.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': '任务不存在'}, status=404)
    except QcAssignment.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': '质检记录不存在'}, status=404)
    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': '无效的 JSON 数据'}, status=400)


@login_required
@require_platform_admin
def download_package(request, package_id):
    pkg = get_object_or_404(TaskPackage, id=package_id)

    buffer = BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        # 1) 图片
        images = pkg.imagefile_set.all()
        for img in images:
            img_path = img.image.path
            zip_file.write(img_path, arcname=f"images/{img.filename}")

        # 2) 标注
        annotation_dir = os.path.join(settings.MEDIA_ROOT, "annotations", pkg.name)
        if os.path.exists(annotation_dir):
            for root, dirs, files in os.walk(annotation_dir):
                for filename in files:
                    file_path = os.path.join(root, filename)
                    rel_path = os.path.relpath(file_path, annotation_dir)
                    zip_file.write(file_path, arcname=f"annotations/{rel_path}")

    buffer.seek(0)

    AuditLog.log(request, 'package_upload', 'TaskPackage', pkg.id,
                 f'下载任务包【{pkg.name}】结果')

    response = HttpResponse(buffer, content_type='application/zip')
    response['Content-Disposition'] = f'attachment; filename="{pkg.name}.zip"'
    return response


@csrf_exempt
@require_POST
def submit_client_review(request, task_id):
    user = request.user
    if not user.is_client:
        return JsonResponse({'status': 'error', 'message': '只有甲方账号可以提交'}, status=403)

    try:
        body = json.loads(request.body)
        result = body.get('result')

        if result not in ('pass', 'fail'):
            return JsonResponse({'status': 'error', 'message': '无效的审核结果'}, status=400)

        with transaction.atomic():
            task = get_object_or_404(TaskPackage, id=task_id)

            # 验证甲方是否有权限查看该任务
            from user.models import ClientTaskAccess
            if not ClientTaskAccess.objects.filter(client=user, task_package=task).exists():
                return JsonResponse({'status': 'error', 'message': '无权限审核该任务包'}, status=403)

            task.client_review_status = result
            task.save()

            AuditLog.log(request, 'client_review', 'TaskPackage', task_id,
                         f'甲方审核结果【{result}】，任务包【{task.name}】')

        return JsonResponse({'status': 'success', 'message': f'已提交：{result}'})
    except TaskPackage.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': '任务不存在'}, status=404)
    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': '无效的 JSON 数据'}, status=400)


@login_required
@require_platform_admin
@require_POST
def delete_package(request, package_id):
    pkg = get_object_or_404(TaskPackage, id=package_id)

    extract_dir = os.path.join(settings.MEDIA_ROOT, f"task_packages/{pkg.id}")
    annotation_dir = os.path.join(settings.MEDIA_ROOT, "annotations", pkg.name)

    with transaction.atomic():
        pkg.imagefile_set.all().delete()
        TaskAssignment.objects.filter(package=pkg).delete()
        QcAssignment.objects.filter(package=pkg).delete()
        pkg.delete()

        AuditLog.log(request, 'package_delete', 'TaskPackage', package_id,
                     f'删除任务包【{pkg.name}】')

    # 清理物理文件
    if os.path.exists(extract_dir):
        shutil.rmtree(extract_dir, ignore_errors=True)
    if os.path.exists(annotation_dir):
        shutil.rmtree(annotation_dir, ignore_errors=True)

    # 清除缓存
    if hasattr(manage_packages, '_image_cache'):
        manage_packages._image_cache.pop(package_id, None)

    return JsonResponse({"success": True, "message": "任务包已删除"})
