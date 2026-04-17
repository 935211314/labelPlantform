from django.urls import path
from django.contrib.auth.views import LoginView, LogoutView

from label.views import annotate_view
from .views import (
    review_join_requests, approve_request, reject_request,
    manage_members, toggle_role, set_role,
    register, home,
    manage_organizations, change_org_admin,organization_detail,delete_org_member,client_manage,assign_client_tasks,client_tasks,delete_client,
)

urlpatterns = [
    path('', home, name='home'),
    path('login/', LoginView.as_view(
        template_name='user/login.html',
        redirect_authenticated_user=True,
        next_page='/'
    ), name='login'),
    path('logout/', LogoutView.as_view(next_page='login'), name='logout'),
    path('register/', register, name='register'),

    # 加入请求审核
    path('join-requests/', review_join_requests, name='review_requests'),
    path('join-requests/approve/<int:request_id>/', approve_request, name='approve_request'),
    path('join-requests/reject/<int:request_id>/', reject_request, name='reject_request'),

    # 成员管理
    path('members/', manage_members, name='manage_members'),
    path('toggle-role/<int:user_id>/<str:role>/', toggle_role, name='toggle_role'),
    path('set-role/<int:user_id>/', set_role, name='set_role'),

    # 组织管理
    path('manage_organizations/', manage_organizations, name='manage_organizations'),
    path('manage_organizations/change_admin/<int:org_id>/', change_org_admin, name='change_org_admin'),
    path('organizations/<int:org_id>/', organization_detail, name='organization_detail'),
    path('organizations/<int:org_id>/members/<int:user_id>/delete/',delete_org_member, name='delete_org_member'),
    path('client_manage/', client_manage, name='client_manage'),
    path('client_manage/<int:client_id>/assign/', assign_client_tasks, name='assign_client_tasks'),
    path('client_manage/<int:client_id>/delete/', delete_client, name='delete_client'),
    path('client/tasks/', client_tasks, name='client_tasks'),
    path('client/tasks/<int:task_id>/', annotate_view, name='client_view_task'),


]

