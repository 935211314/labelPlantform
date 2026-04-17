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
let p1 = {};
let ctrlPressed = false;

let selectedBoxIndex = -1;   // 当前选中的框索引，-1 表示未选中
let historyStack = [];       // 用于撤销操作的历史栈

let boxesHidden = false;     // 标注框是否隐藏（false 为显示，true 为隐藏）

const canvas = document.querySelector('.Imcanvas');
const ctx = canvas.getContext('2d');


// ✅ 原始文件名数组（无随机后缀，后端注入）。长度应与 image_urls 一致
const imageNames = Array.isArray(window.image_names) && window.image_names.length === image_urls.length
  ? window.image_names
  : image_urls.map(u => decodeURIComponent(u.split('/').pop())); // 兜底：从 URL 截取

////////////////////////////////////////////////////
//  放大缩小 & 拖动增强功能所需全局变量          //
////////////////////////////////////////////////////
let zoomScale = 1;       // 缩放比例（默认 1）
let offsetX = 0;         // 水平偏移
let offsetY = 0;         // 垂直偏移
let isPanning = false;   // 是否处于拖拽模式 (按下空格)
let lastMouseX = 0, lastMouseY = 0;

// 设置画笔粗细
ctx.lineWidth = 3;

let currentBox = {};                       // 当前正在绘制的标注框对象

const taskName = typeof task_name !== "undefined" ? task_name : "default_task";

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
  // ✅ 使用后端给的"原始文件名"，避免把 URL 上的随机后缀当成真名
  const imgName = imageNames[imgIndex];
  const targetIndex = imgIndex; // ✅ 快照当前索引，防止异步回调中索引已变

  currentImage.name = imgName;

  // ✅ 防止沿用上一张图的 ann 文件名
  currentImage.annFilename = null;

  currentImage.onload = () => {
    // ✅ 关键：如果用户在图片加载期间又切换了，丢弃这张过时的回调
    if (targetIndex !== imgIndex) {
      console.log(`⚠️ 丢弃过时图片加载回调：${imgName}，当前索引已切换到 ${imgIndex}`);
      return;
    }
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;

    loadAnnotation(imgName, () => {
      resetCurrentObj();
      renderOriginalImage();
      updateImageCounter();   // ✅ 加这里
    });
  };

  currentImage.onerror = () => {
    // ✅ 同样检查是否是过时回调
    if (targetIndex !== imgIndex) return;
    alert("图片加载失败：" + imgUrl);
  };

  currentImage.src = imgUrl;
}



///////////////////////////////////////////////
//         加载本地 JSON 标注数据              //
///////////////////////////////////////////////
function parseCustomTxt(res) {
  return res.text().then(text => {
    const lines = text.trim().split('\n').filter(l => l.trim());
    const objs = lines.map(line => {
      const parts = line.split(';');
      const xmin = +(parts[1] || 0);
      const ymin = +(parts[2] || 0);
      const xmax = +(parts[3] || 0);
      const ymax = +(parts[4] || 0);
      let label = parts[5] ? parts[5].trim() : '';
      if (!label || label === 'undefined' || label === 'null') {
        label = 'unlabeled';
      }

      let obj = { xmin, ymin, xmax, ymax, label, shape_type: "rectangle", labelColor: "#FF0000" };

      // ✅ 如果有 error_note=xxx 就解析出来
      const notePart = parts.find(p => p.startsWith("error_note="));
      if (notePart) {
        obj.error_note = notePart.replace("error_note=", "");
      }

      return obj;
    });
    return { objs };
  });
}


function parseYoloTxt(res) {
  return res.text().then(text => {
    const lines = text.trim().split('\n').filter(Boolean);
    const W = currentImage.width || 1;   // 图像宽
    const H = currentImage.height || 1;  // 图像高

    const objs = lines.map(line => {
      const parts = line.trim().split(/\s+/);
      const cls = parseFloat(parts[0]) || 0;
      const cx  = (parseFloat(parts[1]) || 0) * W;
      const cy  = (parseFloat(parts[2]) || 0) * H;
      const w   = (parseFloat(parts[3]) || 0) * W;
      const h   = (parseFloat(parts[4]) || 0) * H;

      const xmin = cx - w / 2;
      const ymin = cy - h / 2;
      const xmax = cx + w / 2;
      const ymax = cy + h / 2;

      let label = cls.toString();
      if (label === 'undefined' || label === 'null') label = 'unlabeled';

      return { xmin, ymin, xmax, ymax, label, shape_type: "rectangle", labelColor: "#FF0000" };
    });

    return { objs };
  });
}



function parseXmlAnnotation(res) {
    return res.text().then(text => {
        const parser = new DOMParser();
        const xml = parser.parseFromString(text, "application/xml");
        const objs = Array.from(xml.getElementsByTagName("object")).map(obj => {
          const nameEl = obj.getElementsByTagName("name")[0];
          let label = nameEl ? nameEl.textContent : '';
          if (!label || typeof label !== 'string' || label === 'undefined' || label === 'null' || label.trim() === '') {
            label = 'unlabeled';
          }
          const xminEl = obj.getElementsByTagName("xmin")[0];
          const yminEl = obj.getElementsByTagName("ymin")[0];
          const xmaxEl = obj.getElementsByTagName("xmax")[0];
          const ymaxEl = obj.getElementsByTagName("ymax")[0];

          return {
            xmin: +(xminEl ? xminEl.textContent : 0),
            ymin: +(yminEl ? yminEl.textContent : 0),
            xmax: +(xmaxEl ? xmaxEl.textContent : 0),
            ymax: +(ymaxEl ? ymaxEl.textContent : 0),
            label: label,
            labelColor: "#FF0000",
            error_note: ""
          };
        });

        return { objs };
    });
}

function parseLabelmeJson(res) {
  return res.json().then(data => {
    const objs = (data.shapes || []).map(shape => {
      let obj = {};
      // ✅ 防御性校验：label 可能是 "undefined"/"null" 字符串
      let label = shape.label;
      if (!label || typeof label !== 'string' || label === 'undefined' || label === 'null' || label === '') {
        label = 'unlabeled';
      }
      if (shape.shape_type === "polygon") {
        obj = {
          label: label,
          labelColor: "#FF0000",
          shape_type: "polygon",
          points: (shape.points || []).map(([x, y]) => [parseFloat(x) || 0, parseFloat(y) || 0])
        };
      } else {
        const pts = shape.points || [];
        const [[xmin, ymin], [xmax, ymax]] = pts.length >= 2 ? pts : [[0,0],[0,0]];
        obj = {
          xmin: parseFloat(xmin) || 0,
          ymin: parseFloat(ymin) || 0,
          xmax: parseFloat(xmax) || 0,
          ymax: parseFloat(ymax) || 0,
          label: label,
          labelColor: "#FF0000",
          shape_type: "rectangle"
        };
      }

      // ✅ 解析 error_note（如果有）
      if (shape.flags && shape.flags.error_note) {
        obj.error_note = shape.flags.error_note;
      } else if (shape.error_note) {
        obj.error_note = shape.error_note;
      }

      return obj;
    });
    return { objs };
  });
}



// 新增：格式→解析器映射的小工具（便于根据后端返回的真实格式选择 parser）
function getParserByFormat(fmt) {
  const f = (fmt || 'json').toLowerCase();
  if (f === 'json') return parseLabelmeJson;
  if (f === 'xml')  return parseXmlAnnotation;
  if (f === 'txt')  return parseCustomTxt;
  if (f === 'yolo') return parseYoloTxt;
  return parseLabelmeJson;
}

function loadAnnotation(imgName, callback) {
  // ✅ 关键修复：加载新图片前先清空标注数据，防止上一张图的数据残留
  currentImage.objects = [];

  const format = (saveFormat?.toLowerCase() || 'json');
  const q = new URLSearchParams({
    task: taskName,
    img: imgName,
    format: format,
    t: Date.now()
  });

  // ① 先向后端解析真实文件名与真实格式
  fetch(`/label/resolve_annotation/?${q.toString()}`)
    .then(res => res.json())
    .then(info => {
      currentImage.annFilename = info.filename;
      const realFmt = (info.format || format).toLowerCase();
      console.log(`🔍 resolve_annotation [${imgName}]: exists=${info.exists}, file=${info.filename}, format=${realFmt}`);

      // ② 不存在标注文件 → 已经是空数组，直接回调
      if (!info.exists) {
        callback?.();
        updateMarkedLabels();
        return;
      }

      // ③ 存在文件：拉取并解析
      const parser = getParserByFormat(realFmt);
      console.log(`📡 获取标注文件: ${info.rel_path}`);
      return fetch(`${info.rel_path}?t=${Date.now()}`)
        .then(r => {
          if (!r.ok) throw new Error("标注文件获取失败");
          return r.text().then(text => {
            // ✅ 打印文件大小用于调试
            console.log(`📄 文件大小: ${text.length} 字节, 前100字符: ${text.substring(0, 100)}`);
            // 用 Blob 重新构造 Response 给 parser 使用
            const blob = new Blob([text], { type: realFmt === 'json' ? 'application/json' : 'text/plain' });
            const newRes = new Response(blob);
            return parser(newRes);
          });
        })
        .then(data => {
          const rawObjs = data.objs || [];
          console.log(`📦 loadAnnotation [${imgName}]: 解析到 ${rawObjs.length} 个对象`);

          // ✅ 安全防护：限制最大对象数，防止异常文件导致页面崩溃
          if (rawObjs.length > 5000) {
            console.error(`⚠️ 标注文件包含 ${rawObjs.length} 个对象，超过安全上限，已截断`);
            rawObjs.length = 5000;
          }

          currentImage.objects = rawObjs.map(obj => {
            if (!obj.label || typeof obj.label !== 'string' || obj.label === 'undefined' || obj.label === 'null') {
              obj.label = 'unlabeled';
            }
            if (!obj.labelColor) obj.labelColor = '#FF0000';
            return obj;
          });
          callback?.();
          updateMarkedLabels();
        });
    })
    .catch(err => {
      console.error("加载标注失败：", imgName, err.message, err.stack);
      // 加载失败时确保不残留脏数据
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
      labelColor: labelColor,
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
  // ✅ 先分两类
  const normalBoxes = [];
  const errorBoxes = [];

  for (const obj of img.objects) {
    if (obj.hidden) continue;
    if (obj.error_note) {
      errorBoxes.push(obj);  // 有备注 → 绿色框
    } else {
      normalBoxes.push(obj); // 没备注 → 普通红框
    }
  }

  // ✅ 先画普通框
  for (const obj of normalBoxes) {
    drawSingleObject(obj, img);
  }

  // ✅ 再画有 error_note 的框 → 永远在最上层
  for (const obj of errorBoxes) {
    drawSingleObject(obj, img);
  }
}

// 单独封装绘制一个框（矩形/多边形）
function drawSingleObject(obj, img) {
  let boxColor = obj.error_note ? "green" : (obj.labelColor || "#FF0000");
  // ✅ 安全获取 label，防止 undefined/null 显示为文本
  const safeLabel = (obj.label && typeof obj.label === 'string' && obj.label !== 'undefined' && obj.label !== 'null')
    ? obj.label : 'unlabeled';

  if (obj.shape_type === "polygon") {
    drawPolygon(obj.points, boxColor);
    const cx = obj.points.reduce((sum, p) => sum + p[0], 0) / obj.points.length;
    const cy = obj.points.reduce((sum, p) => sum + p[1], 0) / obj.points.length;
    const [ccx, ccy] = imageXYtoCanvasXY(currentImage, cx, cy);
    ctx.fillStyle = boxColor;
    ctx.fillText(safeLabel, ccx + 4, ccy);
  } else {
    const [x1, y1] = imageXYtoCanvasXY(img, obj.xmin, obj.ymin);
    const [x2, y2] = imageXYtoCanvasXY(img, obj.xmax, obj.ymax);
    drawRect(x1, y1, x2 - x1, y2 - y1, boxColor);
    ctx.fillStyle = boxColor;
    ctx.fillText(safeLabel, x1 + 4, y1 + 16);
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
    const p2 = { x: limitedX, y: limitedY };

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
    endDrawingAndPushBox();
  }
};

// ✅ 完成当前绘制中的矩形框并推入对象列表（统一入口，onmouseup 和 forceSaveThen 共用）
function endDrawingAndPushBox() {
  isDrawing = false;
  if (currentBox && currentBox.w > 0 && currentBox.h > 0) {
    const [xmin, ymin] = canvasXYtoImageXY(currentImage, currentBox.x, currentBox.y);
    const [xmax, ymax] = canvasXYtoImageXY(currentImage, currentBox.x + currentBox.w, currentBox.y + currentBox.h);
    currentBox.xmin = xmin;
    currentBox.ymin = ymin;
    currentBox.xmax = xmax;
    currentBox.ymax = ymax;

    // ✅ 强制保证 label 有效
    if (!currentBox.label || typeof currentBox.label !== 'string' || currentBox.label === 'undefined') {
      const checkedInput = document.querySelector('input[name="label"]:checked');
      currentBox.label = (checkedInput && checkedInput.value) ? checkedInput.value : 'unlabeled';
    }
    if (!currentBox.labelColor) currentBox.labelColor = '#FF0000';
    currentBox.shape_type = 'rectangle';

    currentImage.objects.push({ ...currentBox });
    historyStack.push({ type: "add", obj: { ...currentBox } });
    resetCurrentObj();
    renderImage(currentImage);
    updateMarkedLabels();
    isModified = true;
  }
}

canvas.ondblclick = function(e) {
  const x = e.offsetX;
  const y = e.offsetY;

  // 先处理多边形闭合逻辑
  if (drawMode === "poly" && isDrawingPoly && polyTempPoints.length >= 3) {
    // ✅ 强制保证 label 有效
    let polyLabel = currentBox.label;
    if (!polyLabel || typeof polyLabel !== 'string' || polyLabel === 'undefined') {
      const checkedInput = document.querySelector('input[name="label"]:checked');
      polyLabel = (checkedInput && checkedInput.value) ? checkedInput.value : 'unlabeled';
    }
    const newPoly = {
      label: polyLabel,
      labelColor: currentBox.labelColor || '#FF0000',
      shape_type: "polygon",
      points: [...polyTempPoints],
      error_note: ""  // 默认无错误
    };
    currentImage.objects.push(newPoly);
    historyStack.push({ type: "add", obj: newPoly });
    polyTempPoints = [];
    isDrawingPoly = false;
    renderImage(currentImage);
    updateMarkedLabels();
    isModified = true;
    return;
  }

  // ✅ 命中检测
  const hitIndex = hitTestFull(x, y);
  if (hitIndex === -1) return;

  // ✅ 改这里：用 currentImage.objects 而不是 annotations
  const targetBox = currentImage.objects[hitIndex];

  if (isQcMode) {
    // 质检模式：双击弹窗编辑错误
    openErrorNoteModal(targetBox, () => {
      isModified = true;
      renderImage(currentImage);
      saveAnnotation(); // 自动保存
    });
  } else {
    // 标注模式：如果有质检备注，双击只读查看
    if (targetBox.error_note && targetBox.error_note.trim() !== "") {
      showReadonlyErrorNote(targetBox.error_note);
    }
  }
};



function drawLabelOnRect(box) {
    ctx.fillStyle = box.labelColor || '#FF0000';
    ctx.font = "14px sans-serif";
    const label = (box.label && typeof box.label === 'string' && box.label !== 'undefined' && box.label !== 'null') ? box.label : 'unlabeled';
    ctx.fillText(label, box.x + 4, box.y + 16);
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
// 保存标注框数据到后端（加入 ann_filename 覆盖同一文件）
function saveAnnotation(onSuccess, onFail) {
  // ✅ 快照保存时的关键状态，防止异步回调中状态已被其他操作改变
  const snapshotName = currentImage.name;
  const snapshotAnnFilename = currentImage.annFilename;
  const snapshotObjects = currentImage.objects.map(o => ({ ...o }));

  const data = {
    imgName: snapshotName,
    objs: snapshotObjects.map(o => {
      // ✅ 强制保证 label 字段存在且为有效字符串
      let safeLabel = o.label;
      if (safeLabel === undefined || safeLabel === null || typeof safeLabel !== 'string' || safeLabel === '') {
        safeLabel = 'unlabeled';
      }
      // 序列化成后端需要的格式（矩形/多边形都兼容）
      let base = {};
      if (o.shape_type === "polygon") {
        base = {
          label: safeLabel,
          labelColor: o.labelColor || '#FF0000',
          shape_type: "polygon",
          points: o.points.map(([x, y]) => [parseFloat(x) || 0, parseFloat(y) || 0])
        };
      } else {
        base = {
          label: safeLabel,
          xmin: parseFloat(o.xmin) || 0,
          xmax: parseFloat(o.xmax) || 0,
          ymin: parseFloat(o.ymin) || 0,
          ymax: parseFloat(o.ymax) || 0,
          shape_type: "rectangle",
          labelColor: o.labelColor || '#FF0000'
        };
      }
      if (o.error_note) base.error_note = o.error_note; // 质检备注透传
      return base;
    }),
    task_name: taskName,
    format: saveFormat,
    ann_filename: snapshotAnnFilename || null
  };

  console.log('💾 saveAnnotation:', data.imgName, 'objects:', data.objs.length);

  fetch("/label/save_annotation/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": getCookie("csrftoken")
    },
    body: JSON.stringify(data)
  })
  .then(res => res.json())
  .then(res => {
    if (res.status === "success") {
      console.log("✅ 保存成功：" + snapshotName, "->", res.filename);
      // ✅ 关键：只在"仍在同一张图"时才更新状态和调用回调
      if (currentImage.name === snapshotName) {
        currentImage.annFilename = res.filename;
        isModified = false;
        onSuccess?.();
      }
      // 如果已切图：不更新 annFilename/isModified，避免污染新图的状态
      // 数据已正确保存到磁盘，下次加载此图时会正确读取
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
  if (isDrawing) endDrawingAndPushBox();
  if (isModified) {
    saveAnnotation(() => callback(), () => callback()); // 失败也继续切图，避免卡住
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
        saveAnnotation(() => showSaveNotice());
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

      // 多边形绘制中的撤销（回退一个顶点）
      if (isDrawingPoly) {
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
        return;
      }

      const last = historyStack.pop();
      if (!last) return;

      switch (last.type) {
        case "add":
          if (last.obj.shape_type === "polygon") {
            currentImage.objects.pop();
            isDrawingPoly = true;
            polyTempPoints = last.obj.points.map(([px, py]) => [px, py]);
            currentBox.label = last.obj.label;
            currentBox.labelColor = last.obj.labelColor;
          } else {
            currentImage.objects.pop();
          }
          break;

        case "delete":
          currentImage.objects.push(last.obj);
          break;

        case "modify":
          currentImage.objects[last.index].label = last.oldLabel;
          break;

        case "batch_rename":
          last.changes.forEach(({ index, oldLabel }) => {
            currentImage.objects[index].label = oldLabel;
          });
          break;

        case "batch_align":
          last.changes.forEach(({ index, oldObject }) => {
            currentImage.objects[index] = oldObject;
          });
          break;

        default:
          console.warn("⚠️ 未知的撤销类型：", last.type);
          break;
      }

      renderImage(currentImage);
      if (isDrawingPoly && polyTempPoints.length > 0) {
        drawTempPolygon(polyTempPoints);
      }
      updateMarkedLabels();
      isModified = true;
    }

});
function getAllLabelsForAutocomplete() {
  let all = [];
  if (Array.isArray(labels)) all = all.concat(labels);
  if (Array.isArray(window.extraLabels)) all = all.concat(window.extraLabels);
  const stored = JSON.parse(localStorage.getItem("customLabels") || "[]");
  all = all.concat(stored);
  return [...new Set(all)]; // 去重
}

// 标签编号显示列表 & 点击高亮
function updateMarkedLabels() {
  const ul = document.getElementById("markedLabels");
  ul.innerHTML = "";
  const labelCount = {};

  currentImage.objects.forEach((obj, index) => {
    // ✅ 强制校验 label，防止 "undefined"/"null" 字符串或 JS undefined
    let label = obj.label;
    if (!label || typeof label !== 'string' || label === 'undefined' || label === 'null' || label === '') {
      label = 'unlabeled';
      obj.label = 'unlabeled';  // 修复原对象
    }
    if (!labelCount[label]) labelCount[label] = 1;
    else labelCount[label] += 1;
    let displayLabel = `${label}${labelCount[label]}`;

    // ✅ 如果有错误说明，给标签后加上 [错误] 标识
    const isError = obj.error_note && obj.error_note.trim() !== "";
    if (isError) {
      displayLabel += " [错误]";
    }

    const li = document.createElement("li");
    li.style.display = "flex";
    li.style.justifyContent = "space-between";
    li.style.alignItems = "center";

    // ✅ 标签名（点击选中、双击编辑）
    const spanLabel = document.createElement("span");
    spanLabel.textContent = displayLabel;
    spanLabel.style.cursor = "pointer";

    // ✅ 如果这个框有错误说明，标签文字标红+加粗
    if (isError) {
      spanLabel.style.color = "red";
      spanLabel.style.fontWeight = "bold";
    } else {
      spanLabel.style.color = "#333";
      spanLabel.style.fontWeight = "normal";
    }

    // ✅ 点击 → 高亮选中框
    spanLabel.onclick = () => {
      selectedBoxIndex = index;
      renderImage(currentImage);
      drawHighlightBox(currentImage.objects[index]);
    };

    // ✅ 双击 → 修改标签（保持原逻辑）
    spanLabel.ondblclick = () => {
      const currentValue = obj.label;
      document.querySelectorAll(".autocomplete-dropdown").forEach(el => el.remove());

      const inputEdit = document.createElement("input");
      inputEdit.type = "text";
      inputEdit.value = currentValue;
      inputEdit.className = "label-edit";

      let autoWidth = Math.min(Math.max(currentValue.length * 14, 120), 300);
      inputEdit.style.width = autoWidth + "px";
      inputEdit.style.padding = "4px 6px";
      inputEdit.style.fontSize = "14px";
      inputEdit.style.border = "1px solid #ccc";
      inputEdit.style.borderRadius = "4px";
      inputEdit.style.boxSizing = "border-box";
      inputEdit.setAttribute("autocomplete", "off");

      li.replaceChild(inputEdit, spanLabel);
      inputEdit.focus();

      const allLabels = getAllLabelsForAutocomplete();

      let dropdown = document.createElement("div");
      dropdown.className = "autocomplete-dropdown";
      dropdown.style.position = "absolute";
      dropdown.style.background = "#fff";
      dropdown.style.border = "1px solid #ccc";
      dropdown.style.zIndex = "2000";
      dropdown.style.maxHeight = "150px";
      dropdown.style.overflowY = "auto";
      dropdown.style.width = "120px";
      dropdown.style.display = "none";

      const rect = inputEdit.getBoundingClientRect();
      dropdown.style.left = rect.left + "px";
      dropdown.style.top = (rect.bottom + window.scrollY) + "px";

      document.body.appendChild(dropdown);

      inputEdit.addEventListener("input", () => {
        const query = inputEdit.value.trim().toLowerCase();
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
            option.onmouseenter = () => option.style.background = "#eee";
            option.onmouseleave = () => option.style.background = "#fff";
            option.onclick = () => {
              inputEdit.value = m;
              dropdown.style.display = "none";
            };
            dropdown.appendChild(option);
          });
        } else {
          dropdown.style.display = "none";
        }
      });

      const saveNewLabel = () => {
        const newValue = inputEdit.value.trim() || currentValue;
        if (newValue !== currentValue) {
          pushHistory("modify", {
            index,
            oldLabel: currentValue
          });
        }
        obj.label = newValue;
        isModified = true;
        saveAnnotation();
        updateMarkedLabels();
        dropdown.remove();
      };

      inputEdit.addEventListener("blur", () => {
        setTimeout(saveNewLabel, 150);
      });

      inputEdit.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          inputEdit.blur();
        }
      });
    };

    // ✅ 删除按钮
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
  const originalLabels = Array.isArray(labels) ? labels.slice() : [];

  // ✅ 优先用 localStorage
  let storedLabels = JSON.parse(localStorage.getItem("customLabels") || "[]");
  if (!Array.isArray(storedLabels) || storedLabels.length === 0) {
    storedLabels = Array.isArray(labels) ? labels.slice() : [];
  }

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


function openErrorNoteModal(box, onSave) {
  // 先移除旧的
  document.querySelectorAll(".qc-error-modal").forEach(el => el.remove());

  const modal = document.createElement("div");
  modal.className = "qc-error-modal";
  Object.assign(modal.style, {
    position: "fixed",
    top: "50%", left: "50%",
    transform: "translate(-50%, -50%)",
    background: "#fff",
    padding: "16px",
    border: "1px solid #ccc",
    borderRadius: "6px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
    zIndex: 9999,
    width: "320px"
  });

  const title = document.createElement("div");
  title.textContent = "请输入错误说明（可留空表示无误）";
  title.style.marginBottom = "8px";
  modal.appendChild(title);

  const textarea = document.createElement("textarea");
  textarea.style.width = "100%";
  textarea.style.height = "80px";
  textarea.value = box.error_note || "";
  modal.appendChild(textarea);

  const btnWrap = document.createElement("div");
  btnWrap.style.marginTop = "8px";
  btnWrap.style.textAlign = "right";

  const btnSave = document.createElement("button");
  btnSave.textContent = "保存";
  btnSave.style.marginRight = "8px";

  const btnCancel = document.createElement("button");
  btnCancel.textContent = "取消";

  btnWrap.appendChild(btnSave);
  btnWrap.appendChild(btnCancel);
  modal.appendChild(btnWrap);

  document.body.appendChild(modal);

  btnSave.onclick = () => {
    box.error_note = textarea.value.trim(); // ✅ 直接写回框对象
    modal.remove();
    onSave?.();
  };
  btnCancel.onclick = () => modal.remove();
}

function showReadonlyErrorNote(note) {
  document.querySelectorAll(".qc-error-modal").forEach(el => el.remove());

  const modal = document.createElement("div");
  modal.className = "qc-error-modal";
  Object.assign(modal.style, {
    position: "fixed",
    top: "50%", left: "50%",
    transform: "translate(-50%, -50%)",
    background: "#fff",
    padding: "16px",
    border: "1px solid #ccc",
    borderRadius: "6px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
    zIndex: 9999,
    width: "300px"
  });

  const title = document.createElement("div");
  title.textContent = "质检员备注：";
  title.style.fontWeight = "bold";
  title.style.marginBottom = "8px";

  const content = document.createElement("div");
  content.textContent = note;

  const btn = document.createElement("button");
  btn.textContent = "关闭";
  btn.style.marginTop = "8px";
  btn.onclick = () => modal.remove();

  modal.appendChild(title);
  modal.appendChild(content);
  modal.appendChild(btn);
  document.body.appendChild(modal);
}


function pushHistory(type, payload) {
  historyStack.push({ type, ...payload });
  isModified = true;
}
