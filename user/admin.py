from django.contrib import admin
from .models import User, Organization, OrganizationJoinRequest, RoleInOrganization

admin.site.register(User)
admin.site.register(Organization)
admin.site.register(OrganizationJoinRequest)
admin.site.register(RoleInOrganization)
