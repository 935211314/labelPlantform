// 全局变量用于暂存当前选中的标注框对象及其索引
var currentErrorBox = null;
var currentErrorBoxIndex = null;

// 获取弹窗及相关元素
var modal = document.getElementById('errorNoteModal');
var textArea = document.getElementById('errorNoteText');
var btnSave = document.getElementById('errorNoteSaveBtn');
var btnCancel = document.getElementById('errorNoteCancelBtn');
var btnClose = document.getElementById('errorNoteClose');

// ✅ 命中检测，判断 canvas 坐标 (offsetX, offsetY) 是否落在某个框内
function hitTestForQC(offsetX, offsetY) {
  if (!currentImage || !currentImage.objects) return -1;

  for (let i = 0; i < currentImage.objects.length; i++) {
    const obj = currentImage.objects[i];
    let hit = false;

    if (obj.shape_type === "polygon" && obj.points) {
      // 多边形 → 用已有 pointInPolygon
      hit = pointInPolygon(offsetX, offsetY, obj.points);
    } else {
      // 矩形框 → 转 canvas 坐标后判断
      const [x1, y1] = imageXYtoCanvasXY(currentImage, obj.xmin, obj.ymin);
      const [x2, y2] = imageXYtoCanvasXY(currentImage, obj.xmax, obj.ymax);

      if (offsetX >= x1 && offsetX <= x2 && offsetY >= y1 && offsetY <= y2) {
        hit = true;
      }
    }

    if (hit) return i;
  }
  return -1;
}

// ✅ 双击事件处理函数（完全替换）
function onAnnotationDblClick(e) {
  // 计算点击的 canvas 坐标
  const rect = e.target.getBoundingClientRect();
  const offsetX = e.clientX - rect.left;
  const offsetY = e.clientY - rect.top;

  const hitIndex = hitTestForQC(offsetX, offsetY);
  if (hitIndex === -1) {
    return; // 双击没点中任何框
  }

  const clickedBox = currentImage.objects[hitIndex];
  currentErrorBox = clickedBox;
  currentErrorBoxIndex = hitIndex;

  // ✅ 质检模式：允许编辑
  if (window.userRole === "qc") {
    textArea.readOnly = false;
    textArea.value = clickedBox.error_note || "";
    btnSave.style.display = "inline-block";

  } else {
    // ✅ 普通标注模式：如果没有错误就不处理，有错误就只读查看
    if (!clickedBox.error_note || clickedBox.error_note.trim() === "") {
      return;
    }
    textArea.readOnly = true;
    textArea.value = clickedBox.error_note;
    btnSave.style.display = "none";
  }

  modal.style.display = "block";
  e.stopPropagation(); // 阻止冒泡，避免触发其他双击事件
}

// ✅ 绑定双击监听到 canvas
var canvasEl = document.querySelector('canvas.Imcanvas');
if (canvasEl) {
  canvasEl.addEventListener('dblclick', onAnnotationDblClick);
}

// ✅ 关闭弹窗
function closeErrorNoteModal() {
  modal.style.display = "none";
  currentErrorBox = null;
  currentErrorBoxIndex = null;
}
btnClose.onclick = closeErrorNoteModal;
btnCancel.onclick = closeErrorNoteModal;

// ✅ 保存按钮事件（质检模式）
btnSave.onclick = function() {
  if (!currentErrorBox) {
    closeErrorNoteModal();
    return;
  }

  const noteText = textArea.value.trim();
  if (noteText) {
    currentErrorBox.error_note = noteText;
    currentErrorBox.labelColor = "green";  // 有错误 → 绿色框
  } else {
    delete currentErrorBox.error_note;
    currentErrorBox.labelColor = "#FF0000"; // 没错误 → 红色
  }

  // ✅ 重绘所有框（drawAllObjects 里会自动绿色显示错误框）
  renderImage(currentImage);

  // ✅ 自动保存，避免丢失质检信息
  saveAnnotation();

  closeErrorNoteModal();
};
