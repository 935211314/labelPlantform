from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.decorators import login_required
from django.shortcuts import render, redirect, get_object_or_404
from django.views.decorators.http import require_POST
from django.db import transaction

from label.models import QcAssignment, TaskAssignment
from .models import OrganizationJoinRequest, User, RoleInOrganization, Organization
from .forms import UserRegistrationForm
from .permissions import require_org_admin, require_platform_admin, require_client
from django.contrib import messages
from django.http import HttpResponseForbidden, JsonResponse
from django.core.paginator import Paginator

from core.models import AuditLog

PAGE_SIZE = 20


##########################################
#   自定义登录视图（检查 is_active 状态）
##########################################
from django.contrib.auth.forms import AuthenticationForm


def login_view(request):
    if request.method == "POST":
        form = AuthenticationForm(request, data=request.POST)
        if form.is_valid():
            username = form.cleaned_data.get("username")
            password = form.cleaned_data.get("password")

            # ✅ 先找用户，判断 is_active
            try:
                user_obj = User.objects.get(username=username)
                if not user_obj.is_active:
                    messages.error(request, "账号已注册，但未通过组织管理员审核，无法登录")
                    return render(request, "user/login.html", {"form": form})
            except User.DoesNotExist:
                pass  # 用户不存在就交给默认验证处理

            # ✅ 正常认证
            user = authenticate(username=username, password=password)
            if user is not None:
                login(request, user)
                AuditLog.log(request, 'login', 'User', user.id, f'用户 {username} 登录成功')
                return redirect("home")
            else:
                messages.error(request, "用户名或密码错误")
        else:
            messages.error(request, "用户名或密码错误")
    else:
        form = AuthenticationForm()

    return render(request, "user/login.html", {"form": form})


##########################################
#   注册视图（注册后禁止登录）
##########################################
def register(request):
    if request.method == 'POST':
        form = UserRegistrationForm(request.POST)
        if form.is_valid():
            user = form.save(commit=False)
            org = user.organization  # ✅ 注册时选择的组织

            # ✅ 判断该组织是否已有成员
            has_members = User.objects.filter(organization=org).exists()

            if not has_members:
                # ✅ 该组织第一个成员 → 自动成为管理员 + 激活账号
                user.is_active = True
                user.is_org_admin = True  # 直接变组织管理员
                user.save()

                # ✅ 不再写入 RoleInOrganization 的 'admin' 角色，统一用 is_org_admin 标记

                messages.success(
                    request,
                    f"🎉 你是组织【{org.name}】的第一个成员，已自动成为管理员并激活账号！"
                )
                AuditLog.log(request, 'register', 'User', user.id, f'组织【{org.name}】首个成员，自动成为管理员')
                return redirect('login')

            else:
                # ✅ 组织已有成员 → 正常走审批流程
                user.is_active = False  # 等待审批才能登录
                user.save()

                # ✅ 生成加入申请
                OrganizationJoinRequest.objects.create(user=user, organization=org)

                messages.success(
                    request,
                    f"✅ 注册成功，已提交加入申请，等待组织管理员审批"
                )
                AuditLog.log(request, 'register', 'User', user.id, f'注册并申请加入组织【{org.name}】')
                return redirect('login')

    else:
        form = UserRegistrationForm()
    return render(request, 'user/register.html', {'form': form})


##########################################
#   审批加入申请（通过后激活账号）
##########################################
@login_required
@require_org_admin
def review_join_requests(request):
    requests = OrganizationJoinRequest.objects.filter(
        organization=request.user.organization,
        is_approved=False
    ).select_related('user')
    return render(request, 'user/review_requests.html', {'requests': requests})


@login_required
@require_org_admin
def approve_request(request, request_id):
    join_request = get_object_or_404(OrganizationJoinRequest, id=request_id)

    if join_request.organization != request.user.organization:
        return HttpResponseForbidden("不能审批其他组织的请求")

    with transaction.atomic():
        join_request.is_approved = True
        join_request.save()

        # ✅ 审批通过 → 激活账号
        approved_user = join_request.user
        approved_user.is_active = True
        approved_user.save()

        AuditLog.log(request, 'approve_request', 'OrganizationJoinRequest', join_request.id,
                     f'通过 {approved_user.username} 的加入申请')

    messages.success(request, f"✅ 已通过 {approved_user.username} 的加入申请，账号已激活")
    return redirect('review_requests')


@login_required
@require_org_admin
def reject_request(request, request_id):
    join_request = get_object_or_404(
        OrganizationJoinRequest,
        id=request_id,
        organization=request.user.organization,
    )

    reject_user = join_request.user
    reject_user_id = reject_user.id
    reject_username = reject_user.username

    with transaction.atomic():
        join_request.delete()
        reject_user.delete()

        AuditLog.log(request, 'reject_request', 'OrganizationJoinRequest', None,
                     f'拒绝并删除 {reject_username} 的申请')

    messages.success(request, f"❌ 已拒绝 {reject_username} 的申请并删除账号")
    return redirect('review_requests')


##########################################
#   主页
##########################################
@login_required
def home(request):
    user = request.user
    username = user.username

    # ✅ 查询当前组织里的角色
    user_roles = []
    if user.organization:
        user_roles = list(
            RoleInOrganization.objects.filter(
                user=user,
                organization=user.organization
            ).values_list('role', flat=True)
        )
    return render(request, 'user/home.html', {
        'username': username,
        'is_org_admin': user.is_org_admin,
        'user_roles': user_roles
    })


@login_required
@require_org_admin
def manage_members(request):
    members = User.objects.filter(organization=request.user.organization)
    roles = RoleInOrganization.objects.filter(organization=request.user.organization)

    # 构建角色映射
    role_map = {}
    for role in roles:
        role_map.setdefault(role.user_id, set()).add(role.role)

    for member in members:
        roles = role_map.get(member.id, set())
        member.roles = roles

        if roles == {'annotator'}:
            member.role_status = 'annotator'
        elif roles == {'reviewer'}:
            member.role_status = 'reviewer'
        elif roles == {'annotator', 'reviewer'}:
            member.role_status = 'both'
        else:
            member.role_status = 'none'

    # 分页
    paginator = Paginator(members, PAGE_SIZE)
    page_number = request.GET.get('page', 1)
    page_obj = paginator.get_page(page_number)

    return render(request, 'user/manage_members.html', {
        'members': members,
        'page_obj': page_obj,
    })


# 角色修改视图
@login_required
@require_org_admin
@require_POST
def toggle_role(request, user_id, role):
    target_user = get_object_or_404(User, id=user_id)

    # 确保是本组织的成员
    if target_user.organization != request.user.organization:
        return HttpResponseForbidden("不能操作其他组织成员")

    # 切换角色：如果有就删，没有就加
    with transaction.atomic():
        role_entry = RoleInOrganization.objects.filter(
            user=target_user, organization=request.user.organization, role=role
        ).first()

        if role_entry:
            role_entry.delete()
        else:
            RoleInOrganization.objects.create(
                user=target_user, organization=request.user.organization, role=role
            )

        AuditLog.log(request, 'role_change', 'RoleInOrganization', None,
                     f'切换 {target_user.username} 的 {role} 角色')

    return redirect('manage_members')


@login_required
@require_org_admin
@require_POST
def set_role(request, user_id):
    member = get_object_or_404(User, id=user_id, organization=request.user.organization)
    role_value = request.POST.get("role")

    with transaction.atomic():
        # 清空旧角色
        RoleInOrganization.objects.filter(user=member, organization=member.organization).delete()

        if role_value == 'annotator':
            RoleInOrganization.objects.create(user=member, organization=member.organization, role='annotator')
        elif role_value == 'reviewer':
            RoleInOrganization.objects.create(user=member, organization=member.organization, role='reviewer')
        elif role_value == 'both':
            RoleInOrganization.objects.create(user=member, organization=member.organization, role='annotator')
            RoleInOrganization.objects.create(user=member, organization=member.organization, role='reviewer')

        AuditLog.log(request, 'role_change', 'RoleInOrganization', None,
                     f'设置 {member.username} 的角色为 {role_value}')

    return redirect('manage_members')


@login_required
@require_platform_admin
def manage_organizations(request):
    organizations = Organization.objects.all().annotate(
        member_count=models.Count('user'),
    )

    org_info_list = []
    for org in organizations:
        current_admin = User.objects.filter(organization=org, is_org_admin=True).first()
        org_info_list.append({
            'org': org,
            'current_admin': current_admin,
        })

    # 分页
    paginator = Paginator(org_info_list, PAGE_SIZE)
    page_number = request.GET.get('page', 1)
    page_obj = paginator.get_page(page_number)

    return render(request, 'user/manage_organizations.html', {
        'org_info_list': org_info_list,
        'page_obj': page_obj,
    })


from django.db import models


@login_required
@require_platform_admin
@require_POST
def change_org_admin(request, org_id):
    org = get_object_or_404(Organization, id=org_id)
    new_admin_id = request.POST.get("admin_user_id")

    if new_admin_id:
        new_admin = get_object_or_404(User, id=new_admin_id, organization=org)

        with transaction.atomic():
            old_admin = User.objects.filter(organization=org, is_org_admin=True).first()

            # 清除当前管理员
            User.objects.filter(organization=org, is_org_admin=True).update(is_org_admin=False)

            # 设置新管理员
            new_admin.is_org_admin = True
            new_admin.save()

            AuditLog.log(request, 'org_admin_change', 'Organization', org.id,
                         f'组织【{org.name}】管理员从 {old_admin.username if old_admin else "无"} 变更为 {new_admin.username}')

    return redirect('manage_organizations')


@login_required
@require_platform_admin
def organization_detail(request, org_id):
    org = get_object_or_404(Organization, id=org_id)
    members = User.objects.filter(organization=org)

    paginator = Paginator(members, PAGE_SIZE)
    page_number = request.GET.get('page', 1)
    page_obj = paginator.get_page(page_number)

    return render(request, 'user/organization_detail.html', {
        'org': org,
        'members': members,
        'page_obj': page_obj,
    })


@login_required
@require_platform_admin
@require_POST
def delete_org_member(request, org_id, user_id):
    org = get_object_or_404(Organization, id=org_id)
    member = get_object_or_404(User, id=user_id, organization=org)

    with transaction.atomic():
        # ✅ 释放该用户领取的任务包/质检包
        TaskAssignment.objects.filter(user=member).delete()
        QcAssignment.objects.filter(user=member).delete()

        # ✅ 删除角色
        RoleInOrganization.objects.filter(user=member, organization=org).delete()

        # ✅ 彻底删除账号
        member.delete()

        AuditLog.log(request, 'member_delete', 'User', None,
                     f'从组织【{org.name}】删除成员 {member.username}')

    messages.success(request, f"成员 {member.username} 已删除，任务包已释放")
    return redirect('organization_detail', org_id=org.id)


@login_required
@require_platform_admin
def client_manage(request):
    from .forms import ClientCreateForm

    # 处理创建甲方账号
    if request.method == "POST":
        form = ClientCreateForm(request.POST)
        if form.is_valid():
            client = form.save(commit=False)
            client.save()
            AuditLog.log(request, 'register', 'User', client.id,
                         f'平台管理员创建甲方账号 {client.username}')
            messages.success(request, "甲方账号创建成功")
            return redirect('client_manage')
    else:
        form = ClientCreateForm()

    # 列出所有甲方账号
    clients = User.objects.filter(is_client=True)
    paginator = Paginator(clients, PAGE_SIZE)
    page_number = request.GET.get('page', 1)
    page_obj = paginator.get_page(page_number)

    return render(request, "user/client_manage.html", {
        "form": form,
        "clients": clients,
        "page_obj": page_obj,
    })


@login_required
@require_platform_admin
@require_POST
def delete_client(request, client_id):
    client = get_object_or_404(User, id=client_id, is_client=True)

    with transaction.atomic():
        # 删除关联的任务包分配
        from user.models import ClientTaskAccess
        ClientTaskAccess.objects.filter(client=client).delete()

        AuditLog.log(request, 'client_delete', 'User', client.id,
                     f'平台管理员删除甲方账号 {client.username}')

        client.delete()

    messages.success(request, f"甲方账号 {client.username} 已删除")
    return redirect('client_manage')


@login_required
@require_platform_admin
def assign_client_tasks(request, client_id):
    from label.models import TaskPackage
    from user.models import ClientTaskAccess

    client = get_object_or_404(User, id=client_id, is_client=True)

    organizations = Organization.objects.all()

    org_id = request.GET.get("org")
    search_name = request.GET.get("q", "")

    # ✅ 使用 select_related 优化
    all_tasks = TaskPackage.objects.all().select_related('allowed_organization').order_by("-created_at")

    if org_id:
        all_tasks = all_tasks.filter(allowed_organization_id=org_id)

    if search_name.strip():
        all_tasks = all_tasks.filter(name__icontains=search_name.strip())

    # ✅ 获取已分配的任务包 ID (单次查询)
    assigned_ids = set(
        ClientTaskAccess.objects.filter(client=client).values_list("task_package_id", flat=True)
    )

    if request.method == "POST":
        selected_ids = request.POST.getlist("task_ids")

        with transaction.atomic():
            # 清空已有分配
            ClientTaskAccess.objects.filter(client=client).delete()

            # 批量创建分配
            bulk_objects = [
                ClientTaskAccess(client=client, task_package_id=task_id)
                for task_id in selected_ids
            ]
            if bulk_objects:
                ClientTaskAccess.objects.bulk_create(bulk_objects)

            AuditLog.log(request, 'client_assign', 'ClientTaskAccess', None,
                         f'为 {client.username} 分配 {len(selected_ids)} 个任务包')

        messages.success(request, f"✅ 已为 {client.username} 分配任务包")
        return redirect("client_manage")

    if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
        from django.template.loader import render_to_string

        html = render_to_string('user/assign_client_tasks_table.html', {
            "client": client,
            "all_tasks": all_tasks,
            "assigned_ids": assigned_ids,
        }, request=request)

        return JsonResponse({'html': html})

    return render(request, "user/assign_client_tasks.html", {
        "client": client,
        "organizations": organizations,
        "all_tasks": all_tasks,
        "assigned_ids": assigned_ids,
        "selected_org": org_id,
        "search_name": search_name,
    })


@login_required
@require_client
def client_tasks(request):
    from label.models import TaskPackage, TaskAssignment, QcAssignment
    from user.models import ClientTaskAccess

    # 找到分配给该甲方账号的任务包 ID
    assigned_task_ids = ClientTaskAccess.objects.filter(client=request.user).values_list('task_package_id', flat=True)

    # ✅ 使用 annotate 一次性获取关联状态，替代 Python 循环查询
    tasks = TaskPackage.objects.filter(id__in=assigned_task_ids).annotate(
        annotation_completed=models.Exists(
            TaskAssignment.objects.filter(package=models.OuterRef('pk'), is_completed=True)
        ),
        annotation_in_progress=models.Exists(
            TaskAssignment.objects.filter(package=models.OuterRef('pk'), is_completed=False)
        ),
        qc_in_progress=models.Exists(
            QcAssignment.objects.filter(package=models.OuterRef('pk'), is_completed=False)
        ),
    ).order_by('-created_at')

    # ✅ 获取筛选条件
    annotation_filter = request.GET.get("annotation_status")
    qc_filter = request.GET.get("qc_status")
    review_filter = request.GET.get("review_status")

    filtered_tasks = []

    for task in tasks:
        # 标注状态
        if hasattr(task, 'annotation_completed') and task.annotation_completed:
            task.annotation_status_display = "已完成"
        elif hasattr(task, 'annotation_in_progress') and task.annotation_in_progress:
            task.annotation_status_display = "进行中"
        else:
            task.annotation_status_display = "未开始"

        # 质检状态
        if task.qc_status == "pass":
            task.qc_status_display = "合格"
        elif task.qc_status == "fail":
            task.qc_status_display = "不合格"
        elif hasattr(task, 'qc_in_progress') and task.qc_in_progress:
            task.qc_status_display = "质检中"
        else:
            task.qc_status_display = "未开始"

        # 甲方审核状态
        if getattr(task, "client_review_status", None) == "pass":
            task.client_review_display = "通过"
        elif getattr(task, "client_review_status", None) == "fail":
            task.client_review_display = "未通过"
        else:
            task.client_review_display = "未开始"

        # 筛选
        if annotation_filter and task.annotation_status_display != annotation_filter:
            continue
        if qc_filter and task.qc_status_display != qc_filter:
            continue
        if review_filter and task.client_review_display != review_filter:
            continue

        filtered_tasks.append(task)

    if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
        from django.template.loader import render_to_string

        html = render_to_string('user/client_tasks_table.html', {
            "tasks": filtered_tasks,
            "annotation_filter": annotation_filter,
            "qc_filter": qc_filter,
            "review_filter": review_filter,
        }, request=request)

        return JsonResponse({'html': html})

    # 分页
    paginator = Paginator(filtered_tasks, PAGE_SIZE)
    page_number = request.GET.get('page', 1)
    page_obj = paginator.get_page(page_number)

    return render(request, "user/client_tasks.html", {
        "tasks": filtered_tasks,
        "annotation_filter": annotation_filter,
        "qc_filter": qc_filter,
        "review_filter": review_filter,
        "page_obj": page_obj,
    })
