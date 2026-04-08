from django import forms
from .models import User, Organization

class UserRegistrationForm(forms.ModelForm):
    password = forms.CharField(widget=forms.PasswordInput)
    organization_code = forms.CharField(label='组织码')

    class Meta:
        model = User
        fields = ['username', 'password', 'organization_code']

    def clean_organization_code(self):
        code = self.cleaned_data.get('organization_code')
        if not Organization.objects.filter(code=code).exists():
            raise forms.ValidationError("组织码无效，请检查")
        return code

    def save(self, commit=True):
        user = super().save(commit=False)
        user.set_password(self.cleaned_data['password'])
        org = Organization.objects.get(code=self.cleaned_data['organization_code'])
        user.organization = org
        if commit:
            user.save()
        return user


class ClientCreateForm(forms.ModelForm):
    password = forms.CharField(widget=forms.PasswordInput, label="密码")

    class Meta:
        model = User
        fields = ['username', 'password']

    def save(self, commit=True):
        user = super().save(commit=False)
        user.is_client = True
        user.set_password(self.cleaned_data['password'])  # ✅ 生成加密密码
        user.raw_password = self.cleaned_data['password'] # ✅ 额外保存明文
        if commit:
            user.save()
        return user
