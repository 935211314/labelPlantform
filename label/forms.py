from django import forms
from .models import TaskPackage

class TaskPackageForm(forms.ModelForm):
    class Meta:
        model = TaskPackage
        fields = ['name', 'zip_file', 'allowed_organization', 'labels','save_format','label_file']
        widgets = {
            'labels': forms.TextInput(attrs={'placeholder': '多个标签用英文逗号分隔，如 car,bus,person'}),
        }
