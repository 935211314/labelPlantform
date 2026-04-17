document.addEventListener("DOMContentLoaded", function () {
  const allExtraLabels = window.extraLabels || [];

  // 代理监听所有双击进入编辑模式的 input
  document.addEventListener("focusin", function (e) {
    const editInput = e.target;

    if (!editInput.classList.contains("label-edit")) return;

    // 防止重复绑定
    if (editInput._autocompleteBound) return;
    editInput._autocompleteBound = true;

    // 创建候选框容器
    const suggestionBox = document.createElement("div");
    suggestionBox.className = "autocomplete-box";
    Object.assign(suggestionBox.style, {
      position: "absolute",
      background: "#fff",
      border: "1px solid #ccc",
      zIndex: 9999,
      maxHeight: "200px",
      overflowY: "auto",
      minWidth: "200px",
      fontSize: "14px",
      display: "none"
    });
    document.body.appendChild(suggestionBox);

    // 根据输入框位置定位候选框
    function updateBoxPosition() {
      const rect = editInput.getBoundingClientRect();
      suggestionBox.style.left = rect.left + window.scrollX + "px";
      suggestionBox.style.top = rect.bottom + window.scrollY + "px";
      suggestionBox.style.width = rect.width + "px";
    }

    // 输入监听 - 模糊搜索
    editInput.addEventListener("input", function () {
      const keyword = editInput.value.trim();
      suggestionBox.innerHTML = "";

      if (!keyword) {
        suggestionBox.style.display = "none";
        return;
      }

      const matched = allExtraLabels.filter(item =>
        item.toLowerCase().includes(keyword.toLowerCase())
      ).slice(0, 20);

      if (matched.length === 0) {
        suggestionBox.style.display = "none";
        return;
      }

      matched.forEach(text => {
        const item = document.createElement("div");
        item.textContent = text;
        Object.assign(item.style, {
          padding: "5px 8px",
          cursor: "pointer"
        });
        item.addEventListener("mouseenter", () => {
          item.style.background = "#007bff";
          item.style.color = "#fff";
        });
        item.addEventListener("mouseleave", () => {
          item.style.background = "#fff";
          item.style.color = "#000";
        });
        item.addEventListener("mousedown", (e) => {
          e.preventDefault();
          editInput.value = text;
          setTimeout(() => editInput.blur(), 50);
          suggestionBox.style.display = "none";
        });
        suggestionBox.appendChild(item);
      });

      updateBoxPosition();
      suggestionBox.style.display = "block";
    });

    // 失焦时关闭并清理事件监听
    editInput.addEventListener("blur", function () {
      setTimeout(() => {
        suggestionBox.style.display = "none";
        window.removeEventListener("scroll", updateBoxPosition);
        window.removeEventListener("resize", updateBoxPosition);
      }, 200);
    });

    // 每次窗口滚动/调整大小时更新候选框位置
    window.addEventListener("scroll", updateBoxPosition);
    window.addEventListener("resize", updateBoxPosition);
  });
});
