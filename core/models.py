from django.db import models
from django.conf import settings


class AuditLog(models.Model):
    """操作日志 - 记录关键操作供审计"""
    ACTION_CHOICES = [
        ('login', '登录'),
        ('logout', '登出'),
        ('register', '注册'),
        ('approve_request', '审批通过'),
        ('reject_request', '审批拒绝'),
        ('role_change', '角色变更'),
        ('package_upload', '任务包上传'),
        ('package_delete', '任务包删除'),
        ('package_claim', '领取任务包'),
        ('package_submit', '提交任务包'),
        ('qc_claim', '领取质检任务'),
        ('qc_submit', '提交质检结果'),
        ('client_assign', '分配甲方任务'),
        ('client_review', '甲方审核'),
        ('member_delete', '删除成员'),
        ('org_admin_change', '组织管理员变更'),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='audit_logs',
        verbose_name='操作用户'
    )
    action = models.CharField(max_length=30, choices=ACTION_CHOICES, verbose_name='操作类型')
    model_name = models.CharField(max_length=100, blank=True, verbose_name='涉及模型')
    object_id = models.PositiveIntegerField(null=True, blank=True, verbose_name='对象ID')
    ip_address = models.GenericIPAddressField(null=True, blank=True, verbose_name='IP地址')
    details = models.TextField(blank=True, default='', verbose_name='详细信息')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='操作时间')

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'action']),
            models.Index(fields=['created_at']),
            models.Index(fields=['action', 'created_at']),
        ]

    def __str__(self):
        user_str = self.user.username if self.user else 'system'
        return f'{user_str} - {self.get_action_display()} - {self.created_at}'

    @classmethod
    def log(cls, request, action, model_name=None, object_id=None, details=''):
        """快捷记录日志方法"""
        user = request.user if hasattr(request, 'user') and request.user.is_authenticated else None
        ip = request.META.get('REMOTE_ADDR', '')
        cls.objects.create(
            user=user,
            action=action,
            model_name=model_name or '',
            object_id=object_id,
            ip_address=ip,
            details=str(details)[:500],  # 限制长度
        )
