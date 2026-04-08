from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.decorators import login_required
from django.shortcuts import render, redirect, get_object_or_404
from django.views.decorators.csrf import csrf_exempt

from label.models import QcAssignment, TaskAssignment
from .models import OrganizationJoinRequest, User, RoleInOrganization, Organization
from .forms import UserRegistrationForm
from django.contrib import messages
from django.http import HttpResponseForbidden
from django.views.decorators.http import require_POST

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

                # ✅ 同步写入角色表（可选）
                RoleInOrganization.objects.create(
                    user=user,
                    organization=org,
                    role='admin'
                )

                messages.success(
                    request,
                    f"🎉 你是组织【{org.name}】的第一个成员，已自动成为管理员并激活账号！"
                )
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
                return redirect('login')

    else:
        form = UserRegistrationForm()
    return render(request, 'user/register.html', {'form': form})



##########################################
#   审批加入申请（通过后激活账号）
##########################################
@login_required
def review_join_requests(request):
    user = request.user
    if not user.is_org_admin:
        return HttpResponseForbidden("您不是组织管理员，无法审核申请。")

    # 仅查看本组织待审批的请求
    requests = OrganizationJoinRequest.objects.filter(
        organization=user.organization,
        is_approved=False
    )
    return render(request, 'user/review_requests.html', {'requests': requests})


@login_required
def approve_request(request, request_id):
    user = request.user
    if not user.is_org_admin:
        return HttpResponseForbidden("无权限")

    join_request = get_object_or_404(OrganizationJoinRequest, id=request_id)

    if join_request.organization != user.organization:
        return HttpResponseForbidden("不能审批其他组织的请求")

    join_request.is_approved = True
    join_request.save()

    # ✅ 审批通过 → 激活账号
    approved_user = join_request.user
    approved_user.is_active = True
    approved_user.save()

    messages.success(request, f"✅ 已通过 {approved_user.username} 的加入申请，账号已激活")
    return redirect('review_requests')


@login_required
def reject_request(request, request_id):
    user = request.user
    if not user.is_org_admin:
        return HttpResponseForbidden("无权限")

    join_request = get_object_or_404(
        OrganizationJoinRequest,
        id=request_id,
        organization=user.organization,
    )

    # ✅ 拒绝时直接删除用户
    reject_user = join_request.user
    join_request.delete()
    reject_user.delete()

    messages.success(request, f"❌ 已拒绝 {reject_user.username} 的申请并删除账号")
    return redirect('review_requests')


##########################################
#   主页（保持不变）
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
def manage_members(request):
    if not request.user.is_org_admin:
        return HttpResponseForbidden("无权限访问")

    members = User.objects.filter(organization=request.user.organization)
    roles = RoleInOrganization.objects.filter(organization=request.user.organization)

    # 构建角色映射
    role_map = {}
    for role in roles:
        role_map.setdefault(role.user_id, set()).add(role.role)

    for member in members:
        roles = role_map.get(member.id, set())
        member.roles = roles

        # 额外添加一个角色状态，模板中用
        if roles == {'annotator'}:
            member.role_status = 'annotator'
        elif roles == {'reviewer'}:
            member.role_status = 'reviewer'
        elif roles == {'annotator', 'reviewer'}:
            member.role_status = 'both'
        else:
            member.role_status = 'none'

    return render(request, 'user/manage_members.html', {
        'members': members
    })


#角色修改视图
@login_required
@require_POST
def toggle_role(request, user_id, role):
    if not request.user.is_org_admin:
        return HttpResponseForbidden("无权限")

    target_user = get_object_or_404(User, id=user_id)

    # 确保是本组织的成员
    if target_user.organization != request.user.organization:
        return HttpResponseForbidden("不能操作其他组织成员")

    # 切换角色：如果有就删，没有就加
    role_entry = RoleInOrganization.objects.filter(
        user=target_user, organization=request.user.organization, role=role
    ).first()

    if role_entry:
        role_entry.delete()
    else:
        RoleInOrganization.objects.create(
            user=target_user, organization=request.user.organization, role=role
        )

    return redirect('manage_members')

@csrf_exempt
@login_required
def set_role(request, user_id):
    if not request.user.is_org_admin:
        return HttpResponseForbidden("无权限")

    member = get_object_or_404(User, id=user_id, organization=request.user.organization)
    role_value = request.POST.get("role")

    # 清空旧角色
    RoleInOrganization.objects.filter(user=member, organization=member.organization).delete()

    if role_value == 'annotator':
        RoleInOrganization.objects.create(user=member, organization=member.organization, role='annotator')
    elif role_value == 'reviewer':
        RoleInOrganization.objects.create(user=member, organization=member.organization, role='reviewer')
    elif role_value == 'both':
        RoleInOrganization.objects.create(user=member, organization=member.organization, role='annotator')
        RoleInOrganization.objects.create(user=member, organization=member.organization, role='reviewer')

    return redirect('manage_members')

@login_required
def manage_organizations(request):
    if not request.user.is_superuser:
        return HttpResponseForbidden("仅平台管理员可访问")

    organizations = Organization.objects.all()
    org_info_list = []

    for org in organizations:
        members = User.objects.filter(organization=org)
        current_admin = members.filter(is_org_admin=True).first()  # 组织管理员（可为 None）

        org_info_list.append({
            'org': org,
            'members': members,
            'current_admin': current_admin
        })

    return render(request, 'user/manage_organizations.html', {
        'org_info_list': org_info_list
    })

@login_required
@require_POST
def change_org_admin(request, org_id):
    if not request.user.is_superuser:
        return HttpResponseForbidden("无权限")

    org = get_object_or_404(Organization, id=org_id)
    new_admin_id = request.POST.get("admin_user_id")

    if new_admin_id:
        new_admin = get_object_or_404(User, id=new_admin_id, organization=org)

        # 清除当前管理员
        User.objects.filter(organization=org, is_org_admin=True).update(is_org_admin=False)

        # 设置新管理员
        new_admin.is_org_admin = True
        new_admin.save()

    return redirect('manage_organizations')

@login_required
def organization_detail(request, org_id):
    # 只有平台管理员能查看
    if not request.user.is_superuser:
        return HttpResponseForbidden("无权限")

    org = get_object_or_404(Organization, id=org_id)
    members = User.objects.filter(organization=org)

    return render(request, 'user/organization_detail.html', {
        'org': org,
        'members': members
    })
@login_required
@require_POST
def delete_org_member(request, org_id, user_id):
    # 只有平台管理员能删除
    if not request.user.is_superuser:
        return HttpResponseForbidden("无权限")

    org = get_object_or_404(Organization, id=org_id)
    member = get_object_or_404(User, id=user_id, organization=org)

    # ✅ 释放该用户领取的任务包/质检包
    TaskAssignment.objects.filter(user=member).delete()
    QcAssignment.objects.filter(user=member).delete()

    # ✅ 删除角色
    RoleInOrganization.objects.filter(user=member, organization=org).delete()

    # ✅ 彻底删除账号
    member.delete()

    messages.success(request, f"成员 {member.username} 已删除，任务包已释放")
    return redirect('organization_detail', org_id=org.id)


@login_required
def client_manage(request):
    # ✅ 仅平台管理员能访问
    if not request.user.is_superuser:
        return HttpResponseForbidden("无权限")

    from .forms import ClientCreateForm

    # 处理创建甲方账号
    if request.method == "POST":
        form = ClientCreateForm(request.POST)
        if form.is_valid():
            form.save()
            messages.success(request, "甲方账号创建成功")
            return redirect('client_manage')
    else:
        form = ClientCreateForm()

    # 列出所有甲方账号
    clients = User.objects.filter(is_client=True)

    return render(request, "user/client_manage.html", {
        "form": form,
        "clients": clients
    })
@login_required
def assign_client_tasks(request, client_id):
    if not request.user.is_superuser:
        return HttpResponseForbidden("无权限")

    # ✅ 导入模型
    from label.models import TaskPackage
    from user.models import ClientTaskAccess, Organization

    client = get_object_or_404(User, id=client_id, is_client=True)

    # ✅ 获取所有组织（用于筛选）
    organizations = Organization.objects.all()

    # ✅ 获取筛选条件
    org_id = request.GET.get("org")          # 按组织筛选
    search_name = request.GET.get("q", "")   # 按任务包名称搜索

    # ✅ 先获取所有任务包
    all_tasks = TaskPackage.objects.all().order_by("-created_at")

    # ✅ 如果筛选组织，过滤任务包
    if org_id:
        all_tasks = all_tasks.filter(allowed_organization_id=org_id)

    # ✅ 如果搜索关键词不为空，模糊匹配任务包名称
    if search_name.strip():
        all_tasks = all_tasks.filter(name__icontains=search_name.strip())

    # ✅ 获取已分配的任务包 ID
    assigned_ids = set(
        ClientTaskAccess.objects.filter(client=client).values_list("task_package_id", flat=True)
    )

    # ✅ 提交保存分配
    if request.method == "POST":
        selected_ids = request.POST.getlist("task_ids")

        # 清空已有分配
        ClientTaskAccess.objects.filter(client=client).delete()

        # 重新创建分配
        for task_id in selected_ids:
            ClientTaskAccess.objects.create(client=client, task_package_id=task_id)

        messages.success(request, f"✅ 已为 {client.username} 分配任务包")
        return redirect("client_manage")

    return render(request, "user/assign_client_tasks.html", {
        "client": client,
        "organizations": organizations,    # ✅ 传入组织列表
        "all_tasks": all_tasks,
        "assigned_ids": assigned_ids,
        "selected_org": org_id,           # ✅ 让模板知道当前选中的组织
        "search_name": search_name,       # ✅ 保留搜索框内容
    })

@login_required
def client_tasks(request):
    # ✅ 仅甲方账号能访问
    if not request.user.is_client:
        return HttpResponseForbidden("无权限")

    from label.models import TaskPackage, TaskAssignment, QcAssignment
    from user.models import ClientTaskAccess

    # 找到分配给该甲方账号的任务包 ID
    assigned_task_ids = ClientTaskAccess.objects.filter(client=request.user).values_list('task_package_id', flat=True)
    tasks = TaskPackage.objects.filter(id__in=assigned_task_ids)

    # ✅ 获取筛选条件
    annotation_filter = request.GET.get("annotation_status")
    qc_filter = request.GET.get("qc_status")
    review_filter = request.GET.get("review_status")

    filtered_tasks = []

    for task in tasks:
        # ---------------------
        # 1️⃣ 标注状态
        assignment = TaskAssignment.objects.filter(package=task).first()
        if assignment:
            task.annotation_status_display = "已完成" if assignment.is_completed else "进行中"
        else:
            task.annotation_status_display = "未开始"

        # ---------------------
        # 2️⃣ 质检状态
        if task.qc_status == "pass":
            task.qc_status_display = "合格"
        elif task.qc_status == "fail":
            task.qc_status_display = "不合格"
        else:
            qc_assign = QcAssignment.objects.filter(package=task).first()
            task.qc_status_display = "质检中" if qc_assign else "未开始"

        # ---------------------
        # 3️⃣ 甲方审核状态
        if getattr(task, "client_review_status", None) == "pass":
            task.client_review_display = "通过"
        elif getattr(task, "client_review_status", None) == "fail":
            task.client_review_display = "未通过"
        else:
            task.client_review_display = "未开始"

        # ---------------------
        # ✅ 根据筛选条件进行过滤
        if annotation_filter and task.annotation_status_display != annotation_filter:
            continue
        if qc_filter and task.qc_status_display != qc_filter:
            continue
        if review_filter and task.client_review_display != review_filter:
            continue

        filtered_tasks.append(task)

    return render(request, "user/client_tasks.html", {
        "tasks": filtered_tasks,
        "annotation_filter": annotation_filter,
        "qc_filter": qc_filter,
        "review_filter": review_filter,
    })
