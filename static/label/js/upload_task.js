document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('uploadForm');
    const progressContainer = document.getElementById('progressContainer');
    const progressBarFill = document.getElementById('progressBarFill');

    form.addEventListener('submit', function (e) {
        e.preventDefault();  // 阻止默认提交，改用 AJAX

        const formData = new FormData(form);
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '', true);

        // ✅ 上传开始，显示进度条
        xhr.upload.addEventListener('loadstart', () => {
            progressContainer.style.display = 'block';
            progressBarFill.style.width = '0%';
            progressBarFill.style.backgroundColor = '#28a745'; // 初始绿色
            progressBarFill.textContent = '0%';
        });

        // ✅ 实时更新进度
        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percent = Math.min((e.loaded / e.total) * 100, 100);
                progressBarFill.style.width = percent.toFixed(2) + '%';
                progressBarFill.textContent = percent.toFixed(0) + '%';
            }
        });

        // ✅ 上传完成回调
        xhr.onload = function () {
            if (xhr.status === 200) {
                // 上传成功
                progressBarFill.style.width = '100%';
                progressBarFill.style.backgroundColor = '#17a2b8'; // 青色表示完成
                progressBarFill.textContent = '✅ 上传完成';

                // 1秒后刷新页面或跳转
                setTimeout(() => {
                    window.location.reload();
                }, 1200);
            } else {
                // 服务器返回错误
                progressBarFill.style.backgroundColor = '#dc3545'; // 红色
                progressBarFill.textContent = '❌ 上传失败（服务器错误）';
            }
        };

        // ✅ 网络异常处理
        xhr.onerror = function () {
            progressBarFill.style.backgroundColor = '#dc3545'; // 红色
            progressBarFill.textContent = '❌ 网络异常，上传失败';
        };

        xhr.send(formData);
    });
});
