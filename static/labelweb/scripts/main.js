///////////////////////////////////////////////
//  图像标注平台 - 主逻辑（重构 + 注释）       //
///////////////////////////////////////////////

let drawMode = "rect"; // 当前绘制模式：rect=矩形, poly=多边形
let polyTempPoints = [];     // 正在绘制的多边形点
let isDrawingPoly = false;   // 是否正在绘制多边形

let isModified = false;  // 标记是否修改过（用于切图前自动保存）

let imgIndex = 0;                         // 当前图片索引
let currentImage = new Image();           // 全局图片对象
currentImage.objects = [];               // 当前图片标注框列表

let isDrawing = false;
let draggingMode = null;     // null | "top" | "bottom" | "left" | "right" | "move" | {type:'vertex', index:i}
let dragTarget = null;
let dragLastX = 0, dragLastY = 0;         // 拖动形状时上一次鼠标位置（用于计算偏移）
let p1 = {}, p2 = {};
let ctrlPressed = false;

let selectedBoxIndex = -1;   // 当前选中的框索引，-1 表示未选中
let historyStack = [];       // 用于撤销操作的历史栈

let boxesHidden = false;     // 标注框是否隐藏（false 为显示，true 为隐藏）

const canvas = document.querySelector('.Imcanvas');
const ctx = canvas.getContext('2d');

////////////////////////////////////////////////////
//  放大缩小 & 拖动增强功能所需全局变量          //
////////////////////////////////////////////////////
let zoomScale = 1;       // 缩放比例（默认 1）
let offsetX = 0;         // 水平偏移
let offsetY = 0;         // 垂直偏移
let isPanning = false;   // 是否处于拖拽模式 (按下空格)
let isDraggingCanvas = false; // 正在拖动画布
let lastMouseX = 0, lastMouseY = 0;

// 设置画笔粗细
ctx.lineWidth = 3;

let currentBox = {};                       // 当前正在绘制的标注框对象
let flag_drawBbox = false;                // 是否正在绘制标注框

const taskName = typeof task_name !== "undefined" ? task_name : "default_task";
const csrftoken = getCookie("csrftoken");

///////////////////////////////////////////////
//          工具函数 - 获取 CSRF Cookie        //
///////////////////////////////////////////////
function getCookie(name) {
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
        cookie = cookie.trim();
        if (cookie.startsWith(name + '=')) {
            return decodeURIComponent(cookie.substring(name.length + 1));
        }
    }
    return null;
}

///////////////////////////////////////////////
//              页面加载初始化                 //
///////////////////////////////////////////////
document.addEventListener("DOMContentLoaded", () => {
  if (Array.isArray(image_urls) && image_urls.length > 0) {
    loadCurrentImage();  // 里面会更新序号
  } else {
    alert("当前任务包没有图片！");
    updateImageCounter();  // 显示 (0/0)
  }
});


///////////////////////////////////////////////
//         加载指定索引图片并显示              //
///////////////////////////////////////////////

function updateImageCounter() {
  const counterEl = document.getElementById("imageCounter");
  if (!counterEl) return;
  const total = image_urls.length || 0;
  const current = total > 0 ? imgIndex + 1 : 0;
  counterEl.textContent = `(${current}/${total})`;
}

function loadCurrentImage() {
  const imgUrl = window.location.origin + image_urls[imgIndex];
  const imgName = image_urls[imgIndex].split("/").pop();
  currentImage.name = imgName;

  currentImage.onload = () => {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    loadAnnotation(imgName, () => {
      resetCurrentObj();
      renderOriginalImage();
      updateImageCounter();   // ✅ 加这里
    });
  };

  currentImage.onerror = () => {
    alert("图片加载失败：" + imgUrl);
  };

  currentImage.src = imgUrl;
}



///////////////////////////////////////////////
//         加载本地 JSON 标注数据              //
///////////////////////////////////////////////
function parseCustomTxt(res) {
    return res.text().then(text => {
        const lines = text.trim().split('\n');
        const objs = lines.map(line => {
            const [img, xmin, ymin, xmax, ymax, label] = line.split(';');
            return { xmin: +xmin, ymin: +ymin, xmax: +xmax, ymax: +ymax, label };
        });
        return { objs };
    });
}

function parseYoloTxt(res) {
    return res.text().then(text => {
        const lines = text.trim().split('\n');
        const objs = lines.map(line => {
            const [cls, cx, cy, w, h] = line.split(' ').map(parseFloat);
            // 假设图像尺寸为 1x1，这里你应该从实际图像尺寸恢复坐标
            const xmin = (cx - w / 2);
            const ymin = (cy - h / 2);
            const xmax = (cx + w / 2);
            const ymax = (cy + w / 2);
            return { xmin, ymin, xmax, ymax, label: cls.toString() }; // 默认用 class_id
        });
        return { objs };
    });
}

function parseXmlAnnotation(res) {
    return res.text().then(text => {
        const parser = new DOMParser();
        const xml = parser.parseFromString(text, "application/xml");
        const objs = Array.from(xml.getElementsByTagName("object")).map(obj => {
            const label = obj.getElementsByTagName("name")[0].textContent;
            const xmin = +obj.getElementsByTagName("xmin")[0].textContent;
            const ymin = +obj.getElementsByTagName("ymin")[0].textContent;
            const xmax = +obj.getElementsByTagName("xmax")[0].textContent;
            const ymax = +obj.getElementsByTagName("ymax")[0].textContent;
            return { xmin, ymin, xmax, ymax, label };
        });
        return { objs };
    });
}

function parseLabelmeJson(res) {
  return res.json().then(data => {
    const objs = (data.shapes || []).map(shape => {
      if (shape.shape_type === "polygon") {
        // ✅ 多边形
        return {
          label: shape.label,
          labelColor: "#FF0000",
          shape_type: "polygon",
          points: shape.points.map(([x, y]) => [parseFloat(x), parseFloat(y)])
        };
      } else {
        // ✅ 默认矩形（取两个对角点）
        const [[xmin, ymin], [xmax, ymax]] = shape.points;
        return {
          xmin: parseFloat(xmin),
          ymin: parseFloat(ymin),
          xmax: parseFloat(xmax),
          ymax: parseFloat(ymax),
          label: shape.label,
          labelColor: "#FF0000",
          shape_type: "rectangle"
        };
      }
    });
    return { objs };
  });
}

function loadAnnotation(imgName, callback) {
  const format = saveFormat?.toLowerCase() || 'json';
  const baseName = imgName.replace(/\.(jpg|jpeg|png)$/i, '');
  let url = `/media/annotations/${taskName}/${baseName}`;
  let parser = null;

  if (format === 'json') {
    url += '.json';
    parser = parseLabelmeJson;
  } else if (format === 'xml') {
    url += '.xml';
    parser = parseXmlAnnotation;
  } else if (format === 'txt') {
    url += '.txt';
    parser = parseCustomTxt;
  } else {
    console.warn("⚠️ 未知格式，默认清空");
    currentImage.objects = [];
    callback?.();
    updateMarkedLabels();
    return;
  }

  fetch(`${url}?t=${Date.now()}`)
    .then(res => {
      if (!res.ok) throw new Error("文件未找到");
      return parser(res);
    })
    .then(data => {
      currentImage.objects = data.objs || [];
      callback?.();
      updateMarkedLabels();
    })
    .catch(() => {
      currentImage.objects = [];
      callback?.();
      updateMarkedLabels();
    });
}

///////////////////////////////////////////////
//         重置当前正在绘制的对象              //
///////////////////////////////////////////////
function resetCurrentObj() {
  const checkedInput = document.querySelector('input[name="label"]:checked');
  let label = "unlabeled";
  let labelColor = "#FF0000";

  if (checkedInput) {
    label = checkedInput.value;

    // ✅ 找到当前radio所在行的label文本
    const labelItem = checkedInput.closest(".label-item");
    if (labelItem) {
      const spanText = labelItem.querySelector(".label-text");
      if (spanText) {
        labelColor = spanText.style.color || "#FF0000";
      }
    }
  }

  currentBox = {
    label: label,
    labelColor: labelColor
  };
}


///////////////////////////////////////////////
//             绘制原始图像与框               //
///////////////////////////////////////////////
function renderOriginalImage() {
    clearCanvas();

    // 缩放比例适配 canvas 尺寸
    const imW = currentImage.width, imH = currentImage.height;
    let k = canvas.width / imW;
    if (imH * k > canvas.height) k = canvas.height / imH;

    currentImage.sizek = k;
    currentImage.focusX = imW / 2;
    currentImage.focusY = imH / 2;

    renderImage(currentImage);

    if (ctrlPressed) {
        ctx.fillStyle = "rgba(255, 255, 0, 0.8)";
        ctx.font = "bold 14px sans-serif";
        ctx.fillText("编辑模式 (按住 Ctrl 可移动/缩放标注框)", 10, 20);
    }
}

///////////////////////////////////////////////
//         将图像绘制到 canvas 上              //
///////////////////////////////////////////////
function renderImage(img) {
    clearCanvas();

    const imW = img.width, imH = img.height;
    const k = Math.min(canvas.width / imW, canvas.height / imH);
    const drawW = imW * k;
    const drawH = imH * k;

    img.sizek = k;
    img.cutx = 0;
    img.cuty = 0;
    img.cutw = imW;
    img.cuth = imH;
    img.canx = (canvas.width - drawW) / 2;
    img.cany = (canvas.height - drawH) / 2;
    img.canw = drawW;
    img.canh = drawH;

    ctx.drawImage(
      img,
      0, 0, imW, imH,
      img.canx + offsetX, img.cany + offsetY,
      drawW * zoomScale, drawH * zoomScale
    );
    drawAllObjects(img);
}

///////////////////////////////////////////////
//             清空画布，背景黑色              //
///////////////////////////////////////////////
function clearCanvas() {
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

///////////////////////////////////////////////
//             绘制所有标注框对象              //
///////////////////////////////////////////////
function drawAllObjects(img) {
  for (const obj of img.objects) {
    if (obj.hidden) continue;

    if (obj.shape_type === "polygon") {
      drawPolygon(obj.points, obj.labelColor);
      // 多边形中心点放 label
      const cx = obj.points.reduce((sum, p) => sum + p[0], 0) / obj.points.length;
      const cy = obj.points.reduce((sum, p) => sum + p[1], 0) / obj.points.length;
      const [ccx, ccy] = imageXYtoCanvasXY(currentImage, cx, cy);
      ctx.fillStyle = obj.labelColor;
      ctx.fillText(obj.label, ccx + 4, ccy);
    } else {
      // 原矩形逻辑
      const [x1, y1] = imageXYtoCanvasXY(img, obj.xmin, obj.ymin);
      const [x2, y2] = imageXYtoCanvasXY(img, obj.xmax, obj.ymax);
      drawRect(x1, y1, x2 - x1, y2 - y1, obj.labelColor);
      ctx.fillStyle = obj.labelColor;
      ctx.fillText(obj.label, x1 + 4, y1 + 16);
    }
  }
}

///////////////////////////////////////////////
//             canvas 坐标转换函数             //
///////////////////////////////////////////////
function canvasXYtoImageXY(img, cx, cy) {
  const scale = 1 / (img.sizek * zoomScale);
  const imgx = (cx - img.canx - offsetX) * scale + img.cutx;
  const imgy = (cy - img.cany - offsetY) * scale + img.cuty;
  return [imgx, imgy];
}

function imageXYtoCanvasXY(img, ix, iy) {
  return [
    (ix - img.cutx) * img.sizek * zoomScale + img.canx + offsetX,
    (iy - img.cuty) * img.sizek * zoomScale + img.cany + offsetY
  ];
}

///////////////////////////////////////////////
//             绘制矩形边框                   //
///////////////////////////////////////////////
function drawRect(x, y, w, h, color = 'red') {
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.strokeRect(x, y, w, h);
}

///////////////////////////////////////////////
//             鼠标事件：框选绘制              //
///////////////////////////////////////////////
function selectBox(index) {
    const selected = currentImage.objects[index];
    currentImage.objects.splice(index, 1);
    currentImage.objects.push(selected);
    selectedBoxIndex = currentImage.objects.length - 1;
    renderImage(currentImage);
    drawHighlightBox(selected);
}

canvas.onmousedown = function (e) {
  if (isPanning) return;
  if (e.button !== 0) return;

  const x = e.offsetX;
  const y = e.offsetY;
  const selected = document.querySelector('input[name="label"]:checked');

  // 如果未选择标签且非 Ctrl 编辑模式，则无法绘制新标注
  if (!selected && !ctrlPressed) {
    alert("请先选择一个标签！");
    return;
  }

  // Ctrl 编辑模式（拖动矩形/多边形）
  if (ctrlPressed) {
    // 优先检查是否命中当前高亮框的拖动锚点
    if (selectedBoxIndex !== -1) {
      const currentObj = currentImage.objects[selectedBoxIndex];
      const handle = checkHandleHit(currentObj, x, y);
      if (handle) {
        dragTarget = currentObj;
        draggingMode = handle;
        // 记录起始拖动位置
        dragLastX = x;
        dragLastY = y;
        return;
      }
    }
    // 未点中锚点 → 整体命中检测
    const hitIndex = hitTestFull(x, y);
    if (hitIndex !== -1) {
      selectedBoxIndex = hitIndex;
      dragTarget = currentImage.objects[selectedBoxIndex];
      // 提升选中对象的层级
      const obj = currentImage.objects.splice(selectedBoxIndex, 1)[0];
      currentImage.objects.push(obj);
      selectedBoxIndex = currentImage.objects.length - 1;
      dragTarget = obj;
      renderImage(currentImage);
      drawHighlightBox(obj);
    }
    return;
  }

  // 多边形绘制模式
  if (drawMode === "poly") {
    const [ix, iy] = canvasXYtoImageXY(currentImage, x, y);
    if (!isDrawingPoly) {
      // 第一次点击：开始绘制新多边形
      isDrawingPoly = true;
      polyTempPoints = [[ix, iy]];
      resetCurrentObj();  // 初始化当前标注的标签和颜色
    } else {
      // 后续点击：追加新顶点
      polyTempPoints.push([ix, iy]);
    }
    // 绘制当前图像和多边形虚线
    renderImage(currentImage);
    drawTempPolygon(polyTempPoints);
    return;
  }

  // 默认矩形框绘制逻辑
  selectedBoxIndex = -1;
  const limitedX = Math.max(currentImage.canx, Math.min(x, currentImage.canx + currentImage.canw));
  const limitedY = Math.max(currentImage.cany, Math.min(y, currentImage.cany + currentImage.canh));
  p1 = { x: limitedX, y: limitedY };
  isDrawing = true;
};

canvas.onmousemove = function (e) {
  const x = e.offsetX;
  const y = e.offsetY;

  // 正在绘制多边形：显示已有线段和从最后一点到鼠标位置的虚线
  if (drawMode === "poly" && isDrawingPoly) {
    renderImage(currentImage);
    drawTempPolygon(polyTempPoints, x, y);
    return;
  }

  // 拖动模式下（Ctrl）移动矩形或多边形
  if (draggingMode && dragTarget) {
    const [ix, iy] = canvasXYtoImageXY(currentImage, x, y);
    if (dragTarget.shape_type === "polygon") {
      if (draggingMode === "move") {
        // 平移整个多边形：根据鼠标移动量平移所有顶点
        const [prev_ix, prev_iy] = canvasXYtoImageXY(currentImage, dragLastX, dragLastY);
        const [curr_ix, curr_iy] = canvasXYtoImageXY(currentImage, x, y);
        const dx = curr_ix - prev_ix;
        const dy = curr_iy - prev_iy;
        dragTarget.points.forEach(pt => {
          pt[0] += dx;
          pt[1] += dy;
        });
        dragLastX = x;
        dragLastY = y;
      } else if (typeof draggingMode === "object" && draggingMode.type === "vertex") {
        // 拖动单个顶点
        const i = draggingMode.index;
        dragTarget.points[i] = [ix, iy];
      }
    } else {
      // 拖动矩形框四边或整体
      if (draggingMode === "top") dragTarget.ymin = iy;
      if (draggingMode === "bottom") dragTarget.ymax = iy;
      if (draggingMode === "left") dragTarget.xmin = ix;
      if (draggingMode === "right") dragTarget.xmax = ix;
      if (draggingMode === "move") {
        const w = dragTarget.xmax - dragTarget.xmin;
        const h = dragTarget.ymax - dragTarget.ymin;
        dragTarget.xmin = ix - w / 2;
        dragTarget.ymin = iy - h / 2;
        dragTarget.xmax = dragTarget.xmin + w;
        dragTarget.ymax = dragTarget.ymin + h;
      }
    }
    isModified = true;
    renderImage(currentImage);
    drawHighlightBox(dragTarget);
    return;
  }

  // 矩形模式：实时绘制预览框
  if (isDrawing) {
    const limitedX = Math.max(currentImage.canx, Math.min(x, currentImage.canx + currentImage.canw));
    const limitedY = Math.max(currentImage.cany, Math.min(y, currentImage.cany + currentImage.canh));
    p2 = { x: limitedX, y: limitedY };

    currentBox.x = Math.min(p1.x, p2.x);
    currentBox.y = Math.min(p1.y, p2.y);
    currentBox.w = Math.abs(p1.x - p2.x);
    currentBox.h = Math.abs(p1.y - p2.y);

    renderImage(currentImage);
    drawRect(currentBox.x, currentBox.y, currentBox.w, currentBox.h, currentBox.labelColor);
    drawLabelOnRect(currentBox);
  }
};

canvas.onmouseup = function (e) {
  if (e.button !== 0) return;

  // 释放拖动状态（矩形/多边形拖拽）
  if (draggingMode) {
    draggingMode = null;
    dragTarget = null;
    return;
  }

  // 结束绘制矩形框
  if (isDrawing) {
    isDrawing = false;
    if (currentBox && currentBox.w > 0 && currentBox.h > 0) {
      const [xmin, ymin] = canvasXYtoImageXY(currentImage, currentBox.x, currentBox.y);
      const [xmax, ymax] = canvasXYtoImageXY(currentImage, currentBox.x + currentBox.w, currentBox.y + currentBox.h);

      currentBox.xmin = xmin;
      currentBox.ymin = ymin;
      currentBox.xmax = xmax;
      currentBox.ymax = ymax;

      currentImage.objects.push({ ...currentBox });
      historyStack.push({ type: "add", obj: { ...currentBox } });

      resetCurrentObj();
      renderImage(currentImage);
      updateMarkedLabels();
      isModified = true;
    }
  }
};

function endDrawingAndPushBox() {
  isDrawing = false;
  if (currentBox && currentBox.w > 0 && currentBox.h > 0) {
    const [xmin, ymin] = canvasXYtoImageXY(currentImage, currentBox.x, currentBox.y);
    const [xmax, ymax] = canvasXYtoImageXY(currentImage, currentBox.x + currentBox.w, currentBox.y + currentBox.h);
    currentBox.xmin = xmin;
    currentBox.ymin = ymin;
    currentBox.xmax = xmax;
    currentBox.ymax = ymax;
    currentImage.objects.push({ ...currentBox });
    historyStack.push({ type: "add", obj: { ...currentBox } });
    resetCurrentObj();
    renderImage(currentImage);
    updateMarkedLabels();
    isModified = true;
  }
}

canvas.ondblclick = function(e) {
  if (drawMode === "poly" && isDrawingPoly && polyTempPoints.length >= 3) {
    // 完成多边形，封闭形状
    const newPoly = {
      label: currentBox.label,
      labelColor: currentBox.labelColor,
      shape_type: "polygon",
      points: [...polyTempPoints]
    };
    currentImage.objects.push(newPoly);
    historyStack.push({ type: "add", obj: newPoly });
    // 重置多边形绘制状态
    polyTempPoints = [];
    isDrawingPoly = false;
    renderImage(currentImage);
    updateMarkedLabels();
    isModified = true;
  }
};

function drawLabelOnRect(box) {
    ctx.fillStyle = box.labelColor || '#FF0000';
    ctx.font = "14px sans-serif";
    ctx.fillText(box.label, box.x + 4, box.y + 16);
}

///////////////////////////////////////////////
//         hitTest & 高亮选中框               //
///////////////////////////////////////////////
function hitTestFull(x, y) {
  const matches = [];
  for (let i = 0; i < currentImage.objects.length; i++) {
    const obj = currentImage.objects[i];
    if (obj.shape_type === "polygon" && Array.isArray(obj.points)) {
      if (pointInPolygon(x, y, obj.points)) {
        const area = polygonArea(obj.points);
        matches.push({ index: i, area });
      }
    } else {
      const [cx1, cy1] = imageXYtoCanvasXY(currentImage, obj.xmin, obj.ymin);
      const [cx2, cy2] = imageXYtoCanvasXY(currentImage, obj.xmax, obj.ymax);
      if (x >= cx1 && x <= cx2 && y >= cy1 && y <= cy2) {
        const area = (cx2 - cx1) * (cy2 - cy1);
        matches.push({ index: i, area });
      }
    }
  }
  if (matches.length === 0) return -1;
  matches.sort((a, b) => a.area - b.area);
  return matches[0].index;
}

function hitTest(x, y) {
  const borderThreshold = 5;
  for (let i = 0; i < currentImage.objects.length; i++) {
    const obj = currentImage.objects[i];
    const [cx1, cy1] = imageXYtoCanvasXY(currentImage, obj.xmin, obj.ymin);
    const [cx2, cy2] = imageXYtoCanvasXY(currentImage, obj.xmax, obj.ymax);
    const inside = (x >= cx1 && x <= cx2 && y >= cy1 && y <= cy2);
    const nearLeft = Math.abs(x - cx1) <= borderThreshold;
    const nearRight = Math.abs(x - cx2) <= borderThreshold;
    const nearTop = Math.abs(y - cy1) <= borderThreshold;
    const nearBottom = Math.abs(y - cy2) <= borderThreshold;
    if (inside && (nearLeft || nearRight || nearTop || nearBottom)) {
      return i;
    }
  }
  return -1;
}

function drawHighlightBox(obj) {
  if (!obj) return;
  if (obj.shape_type === "polygon") {
    // 高亮多边形：黄线边框，橙色顶点和中心十字
    ctx.strokeStyle = 'yellow';
    ctx.lineWidth = 2;
    ctx.beginPath();
    obj.points.forEach(([px, py], i) => {
      const [cx, cy] = imageXYtoCanvasXY(currentImage, px, py);
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    });
    ctx.closePath();
    ctx.stroke();
    // 绘制顶点锚点（橙色圆点）
    obj.points.forEach(([px, py]) => {
      const [cx, cy] = imageXYtoCanvasXY(currentImage, px, py);
      ctx.fillStyle = 'orange';
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, 2 * Math.PI);
      ctx.fill();
    });
    // 绘制移动柄（中心十字）
    const centerX = obj.points.reduce((sum, p) => sum + p[0], 0) / obj.points.length;
    const centerY = obj.points.reduce((sum, p) => sum + p[1], 0) / obj.points.length;
    const [ccx, ccy] = imageXYtoCanvasXY(currentImage, centerX, centerY);
    drawCross(ccx, ccy, 'move');
  } else {
    // 高亮矩形框
    const [x1, y1] = imageXYtoCanvasXY(currentImage, obj.xmin, obj.ymin);
    const [x2, y2] = imageXYtoCanvasXY(currentImage, obj.xmax, obj.ymax);
    ctx.strokeStyle = 'yellow';
    ctx.lineWidth = 2;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    // 绘制四边中点
    drawHandle((x1 + x2) / 2, y1);
    drawHandle((x1 + x2) / 2, y2);
    drawHandle(x1, (y1 + y2) / 2);
    drawHandle(x2, (y1 + y2) / 2);
    // 绘制顶部移动十字
    drawCross((x1 + x2) / 2, y1 - 16, 'move');
  }
}

function drawHandle(x, y) {
  ctx.fillStyle = 'orange';
  ctx.beginPath();
  ctx.arc(x, y, 8, 0, 2 * Math.PI);
  ctx.fill();
}

function drawCross(x, y, type) {
  ctx.strokeStyle = 'orange';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 5, y);
  ctx.lineTo(x + 5, y);
  ctx.moveTo(x, y - 5);
  ctx.lineTo(x, y + 5);
  ctx.stroke();
}

function checkHandleHit(obj, x, y) {
  const threshold = 10;
  if (obj.shape_type === "polygon") {
    // 检查多边形顶点
    for (let i = 0; i < obj.points.length; i++) {
      const [cx, cy] = imageXYtoCanvasXY(currentImage, obj.points[i][0], obj.points[i][1]);
      if (Math.abs(x - cx) < threshold && Math.abs(y - cy) < threshold) {
        return { type: "vertex", index: i };
      }
    }
    // 检查多边形中心（移动柄）
    const centerX = obj.points.reduce((sum, p) => sum + p[0], 0) / obj.points.length;
    const centerY = obj.points.reduce((sum, p) => sum + p[1], 0) / obj.points.length;
    const [ccx, ccy] = imageXYtoCanvasXY(currentImage, centerX, centerY);
    if (Math.abs(x - ccx) < threshold && Math.abs(y - ccy) < threshold) {
      return "move";
    }
    return null;
  }
  // 检查矩形四边和顶部移动柄
  const [x1, y1] = imageXYtoCanvasXY(currentImage, obj.xmin, obj.ymin);
  const [x2, y2] = imageXYtoCanvasXY(currentImage, obj.xmax, obj.ymax);
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  function inCircle(cx, cy) {
    return Math.abs(x - cx) < threshold && Math.abs(y - cy) < threshold;
  }
  if (inCircle(cx, y1)) return "top";
  if (inCircle(cx, y2)) return "bottom";
  if (inCircle(x1, cy)) return "left";
  if (inCircle(x2, cy)) return "right";
  if (inCircle(cx, y1 - 16)) return "move";
  return null;
}

///////////////////////////////////////////////
//         保存标注框数据到后端                //
///////////////////////////////////////////////
function saveAnnotation(onSuccess, onFail) {
  const data = {
    imgName: currentImage.name,
    objs: currentImage.objects.map(o => {
      if (o.shape_type === "polygon") {
        return {
          label: o.label,
          labelColor: o.labelColor,
          shape_type: "polygon",
          points: o.points.map(([x, y]) => [parseFloat(x), parseFloat(y)])
        };
      } else {
        return {
          label: o.label,
          xmin: parseFloat(o.xmin),
          xmax: parseFloat(o.xmax),
          ymin: parseFloat(o.ymin),
          ymax: parseFloat(o.ymax),
          shape_type: "rectangle"
        };
      }
    }),
    task_name: taskName,
    format: saveFormat
  };

  fetch("/label/save_annotation/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrftoken
    },
    body: JSON.stringify(data)
  })
    .then(res => res.json())
    .then(res => {
      if (res.status === "success") {
        console.log("✅ 保存成功：" + currentImage.name);
        isModified = false;
        onSuccess?.();
      } else {
        alert("保存失败：" + res.message);
        onFail?.();
      }
    })
    .catch(err => {
      alert("保存失败：" + err.message);
      onFail?.();
    });
}

function forceSaveThen(callback) {
    if (isDrawing) {
        endDrawingAndPushBox();
    }
    if (isModified) {
        saveAnnotation(() => {
            callback();
        });
    } else {
        callback();
    }
}

document.getElementById("prevIm").onclick = () => {
    if (imgIndex > 0) {
        forceSaveThen(() => {
            imgIndex--;
            loadCurrentImage();
        });
    } else {
        alert("已经是第一张");
    }
};

document.getElementById("nextIm").onclick = () => {
    if (imgIndex < image_urls.length - 1) {
        forceSaveThen(() => {
            imgIndex++;
            loadCurrentImage();
        });
    } else {
        alert("已经是最后一张");
    }
};

///////////////////////////////////////////////
//         控制按钮：隐藏/显示标注框           //
///////////////////////////////////////////////
document.getElementById("toggleBoxes").onclick = () => {
    if (!boxesHidden) {
        boxesHidden = true;
        currentImage.objects.forEach(box => box.hidden = true);
        renderImage(currentImage);
        document.getElementById("toggleBoxes").textContent = "显示标注框";
    } else {
        boxesHidden = false;
        currentImage.objects.forEach(box => box.hidden = false);
        renderImage(currentImage);
        document.getElementById("toggleBoxes").textContent = "隐藏标注框";
    }
};

///////////////////////////////////////////////
//             标签选择器绑定逻辑              //
///////////////////////////////////////////////
document.querySelector('.Label').onclick = () => {
    const input = $('input[name=label]:checked');
    const label = input.val();
    const color = $('label[for="' + input.attr('id') + '"]').css('color');
    currentBox.label = label;
    currentBox.labelColor = color;
    isModified = true;
};

///////////////////////////////////////////////
//       键盘快捷键支持：A/D 切换图片          //
///////////////////////////////////////////////
document.addEventListener("keydown", function (event) {
    const key = event.key.toLowerCase();
    if (key === "a") {
        document.getElementById("prevIm").click();
    } else if (key === "d") {
        document.getElementById("nextIm").click();
    } else if (key === "s") {
        saveAnnotation(() => {
            forceSaveThen(() => {
                showSaveNotice();
            });
        });
    }

    // 删除选中框
    if (key === "delete" && selectedBoxIndex !== -1) {
        const deleted = currentImage.objects.splice(selectedBoxIndex, 1)[0];
        historyStack.push({ type: "delete", obj: deleted });
        selectedBoxIndex = -1;
        renderOriginalImage();
        updateMarkedLabels();
        isModified = true;
    }

    // 撤销（Ctrl + Z）
    if ((event.ctrlKey || event.metaKey) && key === "z") {
        event.preventDefault();
        if (isDrawingPoly) {
            // 未封闭多边形：撤销最近一个顶点
            if (polyTempPoints.length > 0) {
                polyTempPoints.pop();
                if (polyTempPoints.length === 0) {
                    isDrawingPoly = false;
                }
            }
            renderImage(currentImage);
            if (isDrawingPoly && polyTempPoints.length > 0) {
                drawTempPolygon(polyTempPoints);
            }
        } else {
            const last = historyStack.pop();
            if (last) {
                if (last.type === "add") {
                    if (last.obj.shape_type === "polygon") {
                        // 撤销封闭的多边形：移除对象并恢复为未完成状态
                        currentImage.objects.pop();
                        isDrawingPoly = true;
                        polyTempPoints = last.obj.points.map(([px, py]) => [px, py]);
                        currentBox.label = last.obj.label;
                        currentBox.labelColor = last.obj.labelColor;
                    } else {
                        currentImage.objects.pop();
                    }
                } else if (last.type === "delete") {
                    currentImage.objects.push(last.obj);
                }
                renderImage(currentImage);
                if (isDrawingPoly && polyTempPoints.length > 0) {
                    drawTempPolygon(polyTempPoints);
                }
                updateMarkedLabels();
            }
        }
    }
});

// 标签编号显示列表 & 点击高亮
function updateMarkedLabels() {
    const ul = document.getElementById("markedLabels");
    ul.innerHTML = "";
    const labelCount = {};
    currentImage.objects.forEach((obj, index) => {
        const label = obj.label;
        if (!labelCount[label]) labelCount[label] = 1;
        else labelCount[label] += 1;
        const displayLabel = `${label}${labelCount[label]}`;
        const li = document.createElement("li");
        li.style.display = "flex";
        li.style.justifyContent = "space-between";
        li.style.alignItems = "center";
        const spanLabel = document.createElement("span");
        spanLabel.textContent = displayLabel;
        spanLabel.style.cursor = "pointer";
        spanLabel.onclick = () => {
            selectedBoxIndex = index;
            renderImage(currentImage);
            drawHighlightBox(currentImage.objects[index]);
        };
        const deleteBtn = document.createElement("span");
        deleteBtn.textContent = "×";
        deleteBtn.style.color = "#888";
        deleteBtn.style.cursor = "pointer";
        deleteBtn.style.marginLeft = "8px";
        deleteBtn.title = "删除该标注";
        deleteBtn.onmouseenter = () => deleteBtn.style.color = "red";
        deleteBtn.onmouseleave = () => deleteBtn.style.color = "#888";
        deleteBtn.onclick = () => {
            const removedObj = currentImage.objects.splice(index, 1)[0];
            historyStack.push({ type: "delete", obj: removedObj });
            selectedBoxIndex = -1;
            renderImage(currentImage);
            updateMarkedLabels();
            isModified = true;
            saveAnnotation();
        };
        li.appendChild(spanLabel);
        li.appendChild(deleteBtn);
        ul.appendChild(li);
    });
}

// Ctrl 键按下/松开状态
document.addEventListener("keydown", (e) => {
    if (e.key === "Control") ctrlPressed = true;
});
document.addEventListener("keyup", (e) => {
    if (e.key === "Control") ctrlPressed = false;
});

document.addEventListener("DOMContentLoaded", function () {
  const labelForm = document.getElementById("labelForm");

  // ✅ 初始 labels（后端传入）
  const originalLabels = labels.slice();

  // ✅ 优先用 localStorage
  let storedLabels = JSON.parse(localStorage.getItem("customLabels")) || labels.slice();

  // ✅ 渲染函数
  function renderLabels() {
    labelForm.innerHTML = "";

    storedLabels.forEach((label, index) => {
      const color = "#" + Math.floor(Math.random() * 16777215).toString(16);

      const div = document.createElement("div");
      div.className = "label-item";

      const leftDiv = document.createElement("div");
      leftDiv.className = "label-left";

      const input = document.createElement("input");
      input.type = "radio";
      input.name = "label";
      input.value = label;
      if (index === 0) input.checked = true;

      const spanText = document.createElement("span");
      spanText.className = "label-text";
      spanText.textContent = label;
      spanText.style.color = color;

      // ✅ 双击编辑
      spanText.ondblclick = () => {
        const oldValue = label;
        const inputEdit = document.createElement("input");
        inputEdit.type = "text";
        inputEdit.value = oldValue;
        inputEdit.className = "label-edit";
        leftDiv.replaceChild(inputEdit, spanText);
        inputEdit.focus();

        inputEdit.addEventListener("blur", () => {
          const newValue = inputEdit.value.trim() || oldValue;
          storedLabels[index] = newValue;
          saveLabelsToLocal();
          renderLabels();
        });

        inputEdit.addEventListener("keydown", (e) => {
          if (e.key === "Enter") inputEdit.blur();
        });
      };

      leftDiv.appendChild(input);
      leftDiv.appendChild(spanText);

      // ✅ 删除按钮
      const delBtn = document.createElement("span");
      delBtn.className = "label-del";
      delBtn.textContent = "×";
      delBtn.onclick = () => {
        storedLabels.splice(index, 1);
        saveLabelsToLocal();
        renderLabels();
      };

      div.appendChild(leftDiv);
      div.appendChild(delBtn);
      labelForm.appendChild(div);
    });
  }

  // ✅ 保存到 localStorage
  function saveLabelsToLocal() {
    localStorage.setItem("customLabels", JSON.stringify(storedLabels));
  }

  // ✅ 添加类别按钮
  document.getElementById("addLabelBtn").onclick = function () {
    const newLabel = prompt("请输入新类别名称：");
    if (newLabel) {
      storedLabels.push(newLabel);
      saveLabelsToLocal();
      renderLabels();
    }
  };

  // ✅ 🔄 重置按钮逻辑
  document.getElementById("resetLabelBtn").onclick = function () {
    if (confirm("确定要重置类别吗？这会还原到最初的默认标签")) {
      localStorage.removeItem("customLabels");   // 清空缓存
      storedLabels = originalLabels.slice();     // 还原原始 labels
      renderLabels();
    }
  };

  // ✅ 首次渲染
  renderLabels();
});



// 保存成功提示
function showSaveNotice(text = "保存成功") {
    const notice = document.getElementById("saveNotice");
    notice.textContent = text;
    notice.style.display = "block";
    setTimeout(() => {
        notice.style.display = "none";
    }, 500);
}

// 提交任务包标注完成
document.getElementById("submitTask").onclick = function () {
  const confirmed = confirm("你确定已经完成该任务包所有图片的标注？");
  if (!confirmed) return;
  fetch(`/label/api/mark_task_done/${task_id}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": getCookie("csrftoken")
    },
    body: JSON.stringify({ task_name: task_name })
  })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        alert("✅ 提交成功，任务包已进入质检流程");
        document.getElementById("submitTask").disabled = true;
        document.getElementById("submitTask").textContent = "已提交";
      } else {
        alert("❌ 提交失败：" + data.message);
      }
    })
    .catch(err => {
      alert("❌ 网络错误，提交失败");
      console.error(err);
    });
};

// 鼠标滚轮缩放（Ctrl + 滚轮）
canvas.addEventListener("wheel", (e) => {
  if (e.ctrlKey) {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    zoomScale *= zoomFactor;
    renderImage(currentImage);
  }
});

// 空格键控制画布拖动模式
document.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    isPanning = true;
    canvas.style.cursor = "grab";
  }
});
document.addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    isPanning = false;
    canvas.style.cursor = "default";
  }
});

// 鼠标拖动画布平移
canvas.addEventListener("mousedown", (e) => {
  if (isPanning) {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    canvas.style.cursor = "grabbing";
    const moveHandler = (e) => {
      const dx = e.clientX - lastMouseX;
      const dy = e.clientY - lastMouseY;
      offsetX += dx;
      offsetY += dy;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      renderImage(currentImage);
    };
    const upHandler = () => {
      canvas.removeEventListener("mousemove", moveHandler);
      canvas.removeEventListener("mouseup", upHandler);
      canvas.style.cursor = isPanning ? "grab" : "default";
    };
    canvas.addEventListener("mousemove", moveHandler);
    canvas.addEventListener("mouseup", upHandler);
  }
});

// 数字0键：重置缩放与偏移
document.addEventListener("keydown", (e) => {
  if (e.key === "0") {
    zoomScale = 1;
    offsetX = 0;
    offsetY = 0;
    renderImage(currentImage);
  }
});

// 绘制模式切换：矩形 / 多边形
document.getElementById("modeRect").addEventListener("click", () => {
  drawMode = "rect";
  document.getElementById("modeRect").classList.add("active");
  document.getElementById("modePoly").classList.remove("active");
});
document.getElementById("modePoly").addEventListener("click", () => {
  drawMode = "poly";
  document.getElementById("modePoly").classList.add("active");
  document.getElementById("modeRect").classList.remove("active");
});

// 绘制多边形（实线闭合形状）
// ✅ 修正后的 drawPolygon：封口后显示完整实线多边形
function drawPolygon(points, color = 'lime') {
  if (points.length < 2) return;

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;

  ctx.beginPath();

  // ✅ 依次连线所有顶点
  points.forEach(([x, y], i) => {
    const [cx, cy] = imageXYtoCanvasXY(currentImage, x, y);
    if (i === 0) {
      ctx.moveTo(cx, cy);
    } else {
      ctx.lineTo(cx, cy);
    }
  });

  // ✅ 回到第一个点闭合路径
  const [firstX, firstY] = imageXYtoCanvasXY(currentImage, points[0][0], points[0][1]);
  ctx.lineTo(firstX, firstY);

  ctx.closePath();
  ctx.stroke();

  // ✅ 再画所有顶点的小圆
  points.forEach(([x, y]) => {
    const [cx, cy] = imageXYtoCanvasXY(currentImage, x, y);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
  });
}


// 点在多边形内判断
function pointInPolygon(px, py, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = imageXYtoCanvasXY(currentImage, points[i][0], points[i][1]);
    const [xj, yj] = imageXYtoCanvasXY(currentImage, points[j][0], points[j][1]);
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// 绘制未完成的多边形（虚线）
function drawTempPolygon(points, mouseX = null, mouseY = null, color = null) {
  if (points.length === 0) return;
  const lineColor = color || currentBox.labelColor || 'lime';
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  points.forEach(([x, y], i) => {
    const [cx, cy] = imageXYtoCanvasXY(currentImage, x, y);
    if (i === 0) ctx.moveTo(cx, cy);
    else ctx.lineTo(cx, cy);
    // 已有顶点圆点
    ctx.fillStyle = lineColor;
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.stroke();
  // 从最后一个顶点到当前鼠标位置的虚线
  if (mouseX !== null && mouseY !== null) {
    const lastPt = points[points.length - 1];
    const [lx, ly] = imageXYtoCanvasXY(currentImage, lastPt[0], lastPt[1]);
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(mouseX, mouseY);
    ctx.stroke();
  }
  ctx.setLineDash([]); // 恢复为实线
}

// 计算多边形面积（用于 hitTestFull 排序）
function polygonArea(points) {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    area += xi * yj - xj * yi;
  }
  return Math.abs(area / 2);
}




