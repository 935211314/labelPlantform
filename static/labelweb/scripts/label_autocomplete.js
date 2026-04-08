document.addEventListener("DOMContentLoaded", function () {
  console.log("✅ label_autocomplete.js loaded");

  // 确保 extraLabels 有数据
  const allExtraLabels = window.extraLabels || [];
  console.log("✅ extraLabels 加载数量:", allExtraLabels.length);

  // 代理监听所有双击进入编辑模式的 input
  document.addEventListener("focusin", function (e) {
    const editInput = e.target;

    // 仅处理编辑标签的 input
    if (!editInput.classList.contains("label-edit")) return;

    // 防止重复绑定
    if (editInput._autocompleteBound) return;
    editInput._autocompleteBound = true;

    // 创建候选框容器
    const suggestionBox = document.createElement("div");
    suggestionBox.className = "autocomplete-box";
    suggestionBox.style.position = "absolute";
    suggestionBox.style.background = "#fff";
    suggestionBox.style.border = "1px solid #ccc";
    suggestionBox.style.zIndex = 9999;
    suggestionBox.style.maxHeight = "200px";
    suggestionBox.style.overflowY = "auto";
    suggestionBox.style.minWidth = "200px";
    suggestionBox.style.fontSize = "14px";
    suggestionBox.style.display = "none";
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
      console.log("🔍 搜索关键词:", keyword);

      // 清空候选框
      suggestionBox.innerHTML = "";

      if (!keyword) {
        suggestionBox.style.display = "none";
        return;
      }

      // 模糊匹配
      const matched = allExtraLabels.filter(item =>
        item.toLowerCase().includes(keyword.toLowerCase())
      ).slice(0, 20); // 只显示前 20 条

      console.log("匹配结果:", matched);

      if (matched.length === 0) {
        suggestionBox.style.display = "none";
        return;
      }

      // 渲染候选项
      matched.forEach(text => {
        const item = document.createElement("div");
        item.textContent = text;
        item.style.padding = "5px 8px";
        item.style.cursor = "pointer";

        // 悬停高亮
        item.addEventListener("mouseenter", () => {
          item.style.background = "#007bff";
          item.style.color = "#fff";
        });
        item.addEventListener("mouseleave", () => {
          item.style.background = "#fff";
          item.style.color = "#000";
        });

        // ✅ 点击候选项替换输入框并触发 blur
        item.addEventListener("mousedown", (e) => {
          e.preventDefault(); // 阻止 blur 提前触发
          editInput.value = text; // 替换输入框内容

          // ✅ 触发 blur，让它回到正常模式并刷新
          setTimeout(() => {
            editInput.blur();
          }, 50);

          suggestionBox.style.display = "none";
        });

        suggestionBox.appendChild(item);
      });

      // 定位 + 显示
      updateBoxPosition();
      suggestionBox.style.display = "block";
    });

    // 失焦时关闭候选框
    editInput.addEventListener("blur", function () {
      setTimeout(() => {
        suggestionBox.style.display = "none";
      }, 200);
    });

    // 每次窗口滚动/调整大小时更新候选框位置
    window.addEventListener("scroll", updateBoxPosition);
    window.addEventListener("resize", updateBoxPosition);
  });
});
