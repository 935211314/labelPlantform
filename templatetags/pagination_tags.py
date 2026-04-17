from django import template

register = template.Library()


@register.inclusion_tag('components/pagination.html', takes_context=True)
def pagination(context, page_obj):
    """
    分页组件使用: {% pagination page_obj %}
    自动保留当前 URL 中的查询参数
    """
    request = context.get('request')
    params = request.GET.copy()

    pages = []
    total_pages = page_obj.paginator.num_pages
    current = page_obj.number

    # 生成页码范围 (最多显示 7 个页码)
    if total_pages <= 7:
        page_range = range(1, total_pages + 1)
    else:
        if current <= 4:
            page_range = list(range(1, 6)) + [None, total_pages]
        elif current >= total_pages - 3:
            page_range = [1, None] + list(range(total_pages - 4, total_pages + 1))
        else:
            page_range = [1, None] + list(range(current - 1, current + 2)) + [None, total_pages]

    for p in page_range:
        if p is None:
            pages.append({'ellipsis': True})
        else:
            params['page'] = p
            pages.append({
                'number': p,
                'is_current': p == current,
                'query_string': params.urlencode(),
            })

    params['page'] = max(1, current - 1)
    prev_params = params.urlencode()
    params['page'] = min(total_pages, current + 1)
    next_params = params.urlencode()

    return {
        'page_obj': page_obj,
        'pages': pages,
        'has_prev': page_obj.has_previous(),
        'has_next': page_obj.has_next(),
        'prev_params': prev_params,
        'next_params': next_params,
        'total_pages': total_pages,
        'current': current,
    }
