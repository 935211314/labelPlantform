from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.http import HttpResponseForbidden
from django.shortcuts import render


class Organization(models.Model):
    name = models.CharField(max_length=100, unique=True)
    code = models.CharField(max_length=10, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


@login_required
def manage_organizations(request):
    if not request.user.is_platform_admin:
        return HttpResponseForbidden("仅平台管理员可访问")

    organizations = Organization.objects.all()
    return render(request, 'user/manage_organizations.html', {
        'organizations': organizations
    })


class User(AbstractUser):
    is_platform_admin = models.BooleanField(default=False)
    organization = models.ForeignKey(Organization, null=True, blank=True, on_delete=models.SET_NULL)
    is_org_admin = models.BooleanField(default=False)
    is_client = models.BooleanField(default=False)
    raw_password = models.CharField(max_length=128, blank=True, null=True)  # ✅ 仅管理员查看


class ClientTaskAccess(models.Model):
    client = models.ForeignKey(
        'user.User',  # ✅ 用字符串引用，避免循环导入
        on_delete=models.CASCADE,
        limit_choices_to={'is_client': True}
    )
    task_package = models.ForeignKey(
        'label.TaskPackage',  # ✅ 用字符串引用，避免循环导入
        on_delete=models.CASCADE
    )

    class Meta:
        unique_together = ('client', 'task_package')

    def __str__(self):
        return f"{self.client.username} → {self.task_package.name}"


class OrganizationJoinRequest(models.Model):
    user = models.ForeignKey('User', on_delete=models.CASCADE)
    organization = models.ForeignKey('Organization', on_delete=models.CASCADE)
    is_approved = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'{self.user.username} -> {self.organization.name}'


class RoleInOrganization(models.Model):
    ROLE_CHOICES = (
        ('annotator', '标注员'),
        ('reviewer', '质检员'),
    )
    user = models.ForeignKey('User', on_delete=models.CASCADE)
    organization = models.ForeignKey('Organization', on_delete=models.CASCADE)
    role = models.CharField(max_length=20, choices=ROLE_CHOICES)

    class Meta:
        unique_together = ('user', 'organization', 'role')

    def __str__(self):
        return f'{self.user.username} - {self.organization.name} - {self.get_role_display()}'
