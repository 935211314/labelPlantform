"""
角色权限装饰器
- @require_platform_admin: 仅平台管理员
- @require_org_admin: 仅组织管理员
- @require_role('annotator'): 仅标注员
- @require_role('reviewer'): 仅质检员
- @require_client: 仅甲方账号
"""
from functools import wraps
from django.http import HttpResponseForbidden, JsonResponse


def require_platform_admin(view_func):
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated or not request.user.is_superuser:
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return JsonResponse({'error': '无权限'}, status=403)
            return HttpResponseForbidden("仅平台管理员可访问")
        return view_func(request, *args, **kwargs)
    return wrapper


def require_org_admin(view_func):
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated or not request.user.is_org_admin:
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return JsonResponse({'error': '无权限'}, status=403)
            return HttpResponseForbidden("仅组织管理员可访问")
        return view_func(request, *args, **kwargs)
    return wrapper


def require_role(role):
    """检查用户是否在 RoleInOrganization 表中拥有指定角色"""
    def decorator(view_func):
        @wraps(view_func)
        def wrapper(request, *args, **kwargs):
            if not request.user.is_authenticated:
                if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                    return JsonResponse({'error': '未登录'}, status=403)
                return HttpResponseForbidden("请先登录")

            # 平台管理员和组织管理员默认拥有所有角色权限
            if request.user.is_superuser or request.user.is_org_admin:
                return view_func(request, *args, **kwargs)

            # 检查角色表
            from user.models import RoleInOrganization
            has_role = RoleInOrganization.objects.filter(
                user=request.user,
                organization=request.user.organization,
                role=role
            ).exists()

            if not has_role:
                if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                    return JsonResponse({'error': '无此角色权限'}, status=403)
                return HttpResponseForbidden(f"需要 {role} 角色权限")
            return view_func(request, *args, **kwargs)
        return wrapper
    return decorator


def require_client(view_func):
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        if not request.user.is_authenticated or not request.user.is_client:
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return JsonResponse({'error': '无权限'}, status=403)
            return HttpResponseForbidden("仅甲方账号可访问")
        return view_func(request, *args, **kwargs)
    return wrapper


def require_permission(view_func):
    """通用权限检查: 传入一个 callable 返回 bool"""
    def decorator(check_func):
        @wraps(view_func)
        def wrapper(request, *args, **kwargs):
            if not check_func(request):
                if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                    return JsonResponse({'error': '无权限'}, status=403)
                return HttpResponseForbidden("无权限访问")
            return view_func(request, *args, **kwargs)
        return wrapper
    return decorator
