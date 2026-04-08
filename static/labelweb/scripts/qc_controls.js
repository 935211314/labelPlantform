(() => {
  // 使用现有的 currentImage，不重复声明
  // 示例：qc相关控制逻辑
  const qcButton = document.getElementById('qcDone');
  const qcOptions = document.getElementById('qcResultOptions');

  if (qcButton && qcOptions) {
    qcButton.addEventListener('click', () => {
      qcOptions.style.display = 'inline-block';
    });

  document.getElementById('qcPass').addEventListener('click', () => {
    fetch(`/label/api/submit_qc_result/${task_id}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCookie('csrftoken')
      },
      body: JSON.stringify({ result: 'pass' })  // ✅ 合格
    }).then(() => {
      alert('✅ 已提交质检结果：合格');
      location.href = '/label/qc_available/';
    });
  });

  document.getElementById('qcFail').addEventListener('click', () => {
    fetch(`/label/api/submit_qc_result/${task_id}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCookie('csrftoken')
      },
      body: JSON.stringify({ result: 'fail' })  // ✅ 不合格
    }).then(() => {
      alert('✅ 已提交质检结果：不合格');
      location.href = '/label/qc_available/';
    });
  });

  }

  // 辅助函数：获取 CSRF Token
  function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
      const cookies = document.cookie.split(';');
      for (let i = 0; i < cookies.length; i++) {
        const cookie = cookies[i].trim();
        if (cookie.substring(0, name.length + 1) === name + '=') {
          cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
          break;
        }
      }
    }
    return cookieValue;
  }
  document.addEventListener('DOMContentLoaded', () => {
  // 控制提交任务或质检按钮显示
  const isQc = (typeof is_qc_mode !== 'undefined') ? is_qc_mode : false;

  if (isQc) {
    document.getElementById('qcControl').style.display = 'inline-block';
    document.getElementById('submitTask').style.display = 'none';
  } else {
    document.getElementById('qcControl').style.display = 'none';
    document.getElementById('submitTask').style.display = 'inline-block';
  }
});

})();
