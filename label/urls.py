# label/urls.py

from django.urls import path

from . import views
from .views import upload_task_package, available_packages, claim_package, my_task_package,manage_packages,available_qc_packages,download_package,submit_client_review

urlpatterns = [
    path('upload/', upload_task_package, name='upload_task_package'),
    path('available/', available_packages, name='available_packages'),
    path('claim/<int:package_id>/', claim_package, name='claim_package'),
    path('my/', my_task_package, name='my_task_package'),
    path('manage/', manage_packages, name='manage_packages'),
    # path('labelweb/', views.label_interface, name='label_interface'),
    path('labelweb/<int:task_id>/', views.annotate_view, name='label_interface'),
    path('resolve_annotation/', views.resolve_annotation, name='resolve_annotation'),
    path('save_annotation/', views.save_annotation, name='save_annotation'),
    path('api/mark_task_done/<int:task_id>', views.mark_task_done, name='mark_task_done'),
    path('qc_available/', available_qc_packages, name='available_qc_packages'),
    path('claim_qc/<int:package_id>/', views.claim_qc_package, name='claim_qc_package'),
    path('api/submit_qc_result/<int:task_id>/', views.submit_qc_result, name='submit_qc_result'),
    path('download/<int:package_id>/', download_package, name='download_package'),
    path('api/client_submit/<int:task_id>/', submit_client_review, name='submit_client_review'),
    path('delete/<int:package_id>/', views.delete_package, name='delete_package'),



]
