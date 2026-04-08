// =============================
// 交互逻辑：帮助弹窗 & 多边形模式限制
// =============================
document.addEventListener("DOMContentLoaded", () => {
  initHelpModal();      // 帮助弹窗
  initPolygonLimit();   // 多边形模式限制
  initRoleButtons();    // 角色按钮显示控制
  initClientSubmit();   // 甲方提交事件绑定
});

/**
 * ✅ 初始化帮助弹窗
 */
function initHelpModal() {
  const helpBtn = document.getElementById('helpBtn');
  const helpModal = document.getElementById('helpModal');
  const closeHelp = document.getElementById('closeHelp');

  if (!helpBtn || !helpModal || !closeHelp) return;

  helpBtn.addEventListener('click', () => {
    helpModal.style.display = 'block';
  });

  closeHelp.addEventListener('click', () => {
    helpModal.style.display = 'none';
  });

  // 点击遮罩关闭弹框
  helpModal.addEventListener('click', (e) => {
    if (e.target === helpModal) {
      helpModal.style.display = 'none';
    }
  });
}

/**
 * ✅ 仅允许 JSON 格式支持多边形
 */
function initPolygonLimit() {
  const polyBtn = document.getElementById("modePoly");
  if (!polyBtn || typeof saveFormat === "undefined") return;

  if (saveFormat !== "json") {
    polyBtn.disabled = true;
    polyBtn.style.opacity = "0.5";
    polyBtn.style.cursor = "not-allowed";

    polyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      alert("⚠️ 当前保存格式不支持多边形，请切换为 JSON 格式！");
    });
  }
}

/**
 * ✅ 根据用户角色显示不同按钮
 * - 甲方：只显示 `甲方提交`
 * - 质检员：只显示 `质检完成 / 合格 / 不合格`
 * - 标注员：只显示 `提交任务包`
 */
function initRoleButtons() {
  if (typeof isClient === "undefined" || typeof isQcMode === "undefined") return;

  const clientSubmitBtn = document.getElementById("clientSubmitBtn");
  const submitTaskBtn = document.getElementById("submitTask");
  const qcControl = document.getElementById("qcControl");

  // 默认全部隐藏，避免闪烁
  if (clientSubmitBtn) clientSubmitBtn.style.display = "none";
  if (submitTaskBtn) submitTaskBtn.style.display = "none";
  if (qcControl) qcControl.style.display = "none";

  if (isClient) {
    // ✅ 甲方
    if (clientSubmitBtn) clientSubmitBtn.style.display = "inline-block";
  } else if (isQcMode) {
    // ✅ 质检员
    if (qcControl) qcControl.style.display = "inline-block";
  } else {
    // ✅ 普通标注员
    if (submitTaskBtn) submitTaskBtn.style.display = "inline-block";
  }
}

/**
 * ✅ 绑定甲方提交按钮事件
 * 采用弹窗选择「通过 / 不通过」方式，和质检交互一致
 */
function initClientSubmit() {
  if (!isClient) return;

  const clientSubmitBtn = document.querySelector("#clientSubmitBtn");
  if (!clientSubmitBtn) return;

  clientSubmitBtn.addEventListener("click", function () {
    // 先检查是否已有弹窗，避免重复创建
    if (document.querySelector(".client-review-modal")) return;

    // ✅ 创建弹窗
    const modal = document.createElement("div");
    modal.className = "client-review-modal";
    modal.innerHTML = `
      <div class="client-review-box">
        <h3>请选择审核结果</h3>
        <div class="client-review-actions">
          <button class="btn btn-pass">✅ 通过</button>
          <button class="btn btn-fail">❌ 不通过</button>
          <button class="btn btn-cancel">✖ 取消</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // ✅ 点击“通过”
    modal.querySelector(".btn-pass").addEventListener("click", () => {
      submitClientReview("pass", modal);
    });

    // ✅ 点击“不通过”
    modal.querySelector(".btn-fail").addEventListener("click", () => {
      submitClientReview("fail", modal);
    });

    // ✅ 点击“取消”
    modal.querySelector(".btn-cancel").addEventListener("click", () => {
      modal.remove();
    });

    // ✅ 点击遮罩关闭
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
  });
}

/**
 * ✅ 发送甲方审核结果
 */
function submitClientReview(result, modal) {
  fetch(`/label/api/client_submit/${task_id}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": getCookie("csrftoken")
    },
    body: JSON.stringify({ result: result })
  })
    .then(res => res.json())
    .then(data => {
      alert(data.message);
      modal.remove();
      if (data.status === "success") {
        window.location.href = "/client/tasks/"; // ✅ 提交后回到甲方任务列表
      }
    });
}
