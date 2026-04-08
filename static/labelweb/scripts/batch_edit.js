document.addEventListener("DOMContentLoaded", () => {
  const markedList = document.getElementById("markedLabels");
  const batchRenameBtn = document.getElementById("batchRenameBtn");
  const batchAlignBtn = document.getElementById("batchAlignBtn");

  // ✅ 读取当前选中的索引
  function getSelectedIndexes() {
    const checkboxes = markedList.querySelectorAll(".batch-select:checked");
    return Array.from(checkboxes).map(cb => parseInt(cb.dataset.index, 10));
  }

  // ✅ 刷新按钮状态
  function updateBatchButtons() {
    const selected = getSelectedIndexes();
    const hasMulti = selected.length > 1;
    batchRenameBtn.disabled = selected.length === 0;  // 只要选1个就能改名
    batchAlignBtn.disabled = !hasMulti;  // 至少2个才能对齐位置
  }

  // ✅ 渲染后增强每个 li，加复选框
  function enhanceMarkedList() {
    const lis = markedList.querySelectorAll("li");
    lis.forEach((li, idx) => {
      if (!li.querySelector(".batch-select")) {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "batch-select";
        checkbox.dataset.index = idx;
        checkbox.style.marginRight = "6px";
        checkbox.addEventListener("change", updateBatchButtons);
        li.prepend(checkbox);
      }
    });
  }

  // ✅ 监听列表变化，自动增强
  const observer = new MutationObserver(() => {
    enhanceMarkedList();
    updateBatchButtons(); // 每次刷新后重新计算按钮状态
  });
  observer.observe(markedList, { childList: true, subtree: false });

  // ================= 批量修改名称 =================
  batchRenameBtn.addEventListener("click", () => {
    const selectedIdx = getSelectedIndexes();
    if (!selectedIdx.length) return;

    // ✅ 弹窗
    const modal = document.createElement("div");
    modal.className = "batch-modal";
    modal.innerHTML = `
      <h3>批量修改名称</h3>
      <input id="batchNameInput" type="text" placeholder="请输入新名称..." />
      <div class="modal-actions">
        <button class="modal-ok">确定</button>
        <button class="modal-cancel">取消</button>
      </div>
    `;
    document.body.appendChild(modal);

    const inputBox = modal.querySelector("#batchNameInput");
    const okBtn = modal.querySelector(".modal-ok");
    const cancelBtn = modal.querySelector(".modal-cancel");

    // ✅ 自动补全
    const allLabels = getAllLabelsForAutocomplete();
    const dropdown = document.createElement("div");
    dropdown.className = "autocomplete-dropdown";
    dropdown.style.position = "absolute";
    dropdown.style.background = "#fff";
    dropdown.style.border = "1px solid #ccc";
    dropdown.style.zIndex = "3000";
    dropdown.style.maxHeight = "150px";
    dropdown.style.overflowY = "auto";
    dropdown.style.width = "200px";
    dropdown.style.display = "none";
    modal.appendChild(dropdown);

    inputBox.addEventListener("input", () => {
      const query = inputBox.value.trim().toLowerCase();
      dropdown.innerHTML = "";
      if (!query) {
        dropdown.style.display = "none";
        return;
      }
      const matches = allLabels.filter(l => l.toLowerCase().includes(query));
      if (matches.length > 0) {
        dropdown.style.display = "block";
        matches.forEach(m => {
          const option = document.createElement("div");
          option.textContent = m;
          option.style.padding = "4px";
          option.style.cursor = "pointer";
          option.onclick = () => {
            inputBox.value = m;
            dropdown.style.display = "none";
          };
          dropdown.appendChild(option);
        });
      } else {
        dropdown.style.display = "none";
      }
    });

    // ✅ 确认批量改名
    okBtn.onclick = () => {
      const newName = inputBox.value.trim();
      if (!newName) return;
      const backup = selectedIdx.map(idx => ({
        index: idx,
        oldLabel: currentImage.objects[idx].label
      }));
      pushHistory("batch_rename", { changes: backup });

      selectedIdx.forEach(idx => {
        currentImage.objects[idx].label = newName;
      });
      isModified = true;

      saveAnnotation(() => {
        updateMarkedLabels(); // 刷新 UI
      });
      modal.remove();
    };

    cancelBtn.onclick = () => modal.remove();
  });

  // ================= 批量对齐位置 =================
batchAlignBtn.addEventListener("click", () => {
  const selectedIdx = getSelectedIndexes();
  if (selectedIdx.length < 2) {
    alert("至少需要选择2个标签才能对齐位置");
    return;
  }

  // ✅ 创建弹窗让用户选择基准框
  const modal = document.createElement("div");
  modal.className = "batch-modal";
  modal.style.minWidth = "300px";
  modal.innerHTML = `<h3>选择基准位置</h3>`;

  const listBox = document.createElement("div");
  listBox.style.maxHeight = "200px";
  listBox.style.overflowY = "auto";
  listBox.style.marginBottom = "10px";

  selectedIdx.forEach(idx => {
    const obj = currentImage.objects[idx];
    const btn = document.createElement("button");
    btn.textContent = obj.label;
    btn.style.display = "block";
    btn.style.width = "100%";
    btn.style.textAlign = "left";
    btn.style.padding = "6px";
    btn.style.marginBottom = "4px";
    btn.style.border = "1px solid #ddd";
    btn.style.borderRadius = "4px";
    btn.style.background = "#f8f8f8";
    btn.style.cursor = "pointer";
    btn.onmouseenter = () => btn.style.background = "#e6f7ff";
    btn.onmouseleave = () => btn.style.background = "#f8f8f8";

    btn.onclick = () => {
      // ✅ 用户选中这个基准框
      const baseIdx = idx;
      const baseBox = currentImage.objects[baseIdx];
      const backup = selectedIdx.map(idx => ({
        index: idx,
        oldObject: JSON.parse(JSON.stringify(currentImage.objects[idx]))
      }));
      pushHistory("batch_align", { changes: backup });

      selectedIdx.forEach(otherIdx => {
        if (otherIdx !== baseIdx) {
          let box = currentImage.objects[otherIdx];

          if (baseBox.shape_type === "polygon") {
            if (box.shape_type === "polygon") {
              box.points = JSON.parse(JSON.stringify(baseBox.points));
            } else {
              // 把矩形转成多边形外接矩形
              const xs = baseBox.points.map(p => p[0]);
              const ys = baseBox.points.map(p => p[1]);
              box.xmin = Math.min(...xs);
              box.ymin = Math.min(...ys);
              box.xmax = Math.max(...xs);
              box.ymax = Math.max(...ys);
              box.shape_type = "rectangle";
            }
          } else {
            // ✅ 基准是矩形
            if (box.shape_type === "polygon") {
              box.points = [
                [baseBox.xmin, baseBox.ymin],
                [baseBox.xmax, baseBox.ymin],
                [baseBox.xmax, baseBox.ymax],
                [baseBox.xmin, baseBox.ymax]
              ];
              box.shape_type = "polygon";
            } else {
              box.xmin = baseBox.xmin;
              box.ymin = baseBox.ymin;
              box.xmax = baseBox.xmax;
              box.ymax = baseBox.ymax;
            }
          }
        }
      });

      isModified = true;
      saveAnnotation(() => {
        renderImage(currentImage);
        updateMarkedLabels();

      });
      modal.remove(); // ✅ 关闭弹窗
    };

    listBox.appendChild(btn);
  });

  modal.appendChild(listBox);

  // 取消按钮
  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "取消";
  cancelBtn.className = "modal-cancel";
  cancelBtn.style.marginTop = "8px";
  cancelBtn.style.background = "#ccc";
  cancelBtn.style.padding = "6px 12px";
  cancelBtn.style.borderRadius = "4px";
  cancelBtn.style.cursor = "pointer";
  cancelBtn.onclick = () => modal.remove();
  modal.appendChild(cancelBtn);

  document.body.appendChild(modal);
});


  // ✅ 页面初次加载也增强一次
  enhanceMarkedList();
});
