(() => {
  const qcButton = document.getElementById('qcDone');
  const qcOptions = document.getElementById('qcResultOptions');

  if (qcButton && qcOptions) {
    qcButton.addEventListener('click', () => {
      qcOptions.style.display = 'inline-block';
    });

    const qcPassBtn = document.getElementById('qcPass');
    const qcFailBtn = document.getElementById('qcFail');

    if (qcPassBtn) {
      qcPassBtn.addEventListener('click', () => {
        fetch(`/label/api/submit_qc_result/${task_id}/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrftoken')
          },
          body: JSON.stringify({ result: 'pass' })
        }).then(() => {
          alert('✅ 已提交质检结果：合格');
          location.href = '/label/qc_available/';
        });
      });
    }

    if (qcFailBtn) {
      qcFailBtn.addEventListener('click', () => {
        fetch(`/label/api/submit_qc_result/${task_id}/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrftoken')
          },
          body: JSON.stringify({ result: 'fail' })
        }).then(() => {
          alert('✅ 已提交质检结果：不合格');
          location.href = '/label/qc_available/';
        });
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
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
