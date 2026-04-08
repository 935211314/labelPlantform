from django.db import models
from django.conf import settings


class TaskPackage(models.Model):
    FORMAT_CHOICES = [
        ('json', 'LabelMe JSON'),
        ('xml', 'Pascal VOC XML'),
        ('txt', 'YOLO TXT'),
    ]
    save_format = models.CharField(max_length=10, choices=FORMAT_CHOICES, default='json')
    labels = models.TextField(blank=True, help_text="多个标签用英文逗号分隔，例如：car,bus,person")
    name = models.CharField(max_length=100)
    zip_file = models.FileField(upload_to='zips/')
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)

    # ✅ 用字符串引用，避免循环导入
    allowed_organization = models.ForeignKey(
        'user.Organization',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        help_text='可以领取该任务包的组织'
    )

    qc_status = models.CharField(
        max_length=10,
        choices=[('pass', '合格'), ('fail', '不合格')],
        null=True,
        blank=True,
        help_text='质检状态'
    )
    # ✅ 甲方独立审核结果
    client_review_status = models.CharField(
        max_length=10,
        choices=[('pass', '通过'), ('fail', '不通过')],
        null=True,
        blank=True,
        help_text='甲方审核状态'
    )
    #标签文件
    label_file = models.FileField(
        upload_to='label_files/',
        null=True,
        blank=True,
        help_text="可选标签库 JSON 文件"
    )
    def get_label_list(self):
        if not self.labels:
            return []
        return [label.strip() for label in self.labels.split(',') if label.strip()]

    def __str__(self):
        return self.name


def image_upload_path(instance, filename):
    # 每个任务包一个独立目录，避免重名
    return f"task_packages/{instance.package.id}/{filename}"

class ImageFile(models.Model):
    package = models.ForeignKey(TaskPackage, on_delete=models.CASCADE)
    filename = models.CharField(max_length=255)
    image = models.ImageField(upload_to=image_upload_path)  # ✅ 改这里



class TaskAssignment(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    package = models.ForeignKey(TaskPackage, on_delete=models.CASCADE)
    assigned_at = models.DateTimeField(auto_now_add=True)
    is_completed = models.BooleanField(default=False)

    class Meta:
        unique_together = ('user', 'package')


class QcAssignment(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    package = models.ForeignKey(TaskPackage, on_delete=models.CASCADE)
    assigned_at = models.DateTimeField(auto_now_add=True)
    is_completed = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('user', 'package')
