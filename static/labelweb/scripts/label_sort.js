document.addEventListener("DOMContentLoaded", () => {
  // ✅ 服装类排序规则
  const labelOrder = ["上衣", "裤子", "半裙", "连衣裙"];

  const fieldsMap = {
    "上衣": [
      "大身廓形", "大身结构", "衣长形式", "袖长形式", "袖子形式", "袖子配色", "肩形", "袖口形式", "袖口配色",
      "袖口明线形式", "袖头形式", "袖头配色", "袖头装饰", "袖头固定形式", "袖头明线", "袖头宽明线",
      "袖头宽明线和袖头明线一体", "袖口折形式", "袖窿明线", "袖窿止口形式", "袖里形式", "门襟形式", "门襟装饰",
      "门襟配色", "门襟方向", "领子配色", "领型", "领子装饰", "前门扣数", "前门钉扣形式", "前门锁眼形式",
      "门襟第一粒扣锁眼形式", "门襟末粒扣锁眼形式", "肩缝明线样式", "下摆形式", "下摆配色", "下摆明线形式",
      "前片形式", "肩部贴布形式", "后背形式", "过肩形式", "过肩明线", "后背开衩形式", "里子形式", "口袋位置",
      "口袋形式", "口袋明线", "袋口锁钉形式", "腰部形式", "领子明线", "门襟明线", "袋盖形式", "领台",
      "领台扣锁眼形式", "胸省形式", "袖花形式", "袖花锁眼形式", "票袋形式", "袖扣形式", "袖袢形式",
      "下口袋形式", "胸袋形式", "肩袢形式", "腰带形式", "飘带款式"
    ],
    "裤子": [
      "裤型", "裤长形式", "裤褶形式", "裤腰形式", "裤腰调节形式", "前袋形式", "脚口形式", "脚口侧缝形式",
      "口袋位置", "口袋形式", "口袋明线", "袋口锁钉形式", "袋盖形式", "前片形式", "前片配色形式",
      "后片形式", "后片配色形式", "后省形式", "侧缝形式", "裤中线形式", "串带类型", "串带数量",
      "宝剑头形式", "门襟形式", "门襟方向", "表袋形式", "后袋形式", "腰带形式"
    ],
    "半裙": [
      "裙型", "裙长形式", "前片形式", "前片钉扣", "前袋形式", "裙褶形式", "后片形式", "后省形式",
      "腰形式", "串带类型", "串带数量", "宝剑头形式", "下摆形式", "下摆配色", "口袋形式",
      "口袋明线", "袋口锁钉形式", "袋盖形式", "口袋位置", "开衩形式", "拉链形式", "后袋形式"
    ],
    "连衣裙": [
      "大身廓形", "裙型", "大身结构", "衣长形式", "袖长形式", "袖子形式", "袖子配色", "肘垫形式", "袖口形式",
      "袖口配色", "袖口明线形式", "袖头形式", "袖头装饰", "袖头高度", "袖头固定形式", "袖头明线",
      "袖头宽明线", "袖头配色", "袖口折形式", "袖袢形式", "袖花锁眼形式", "袖花形式", "袖窿明线",
      "袖窿止口形式", "袖里形式", "门襟形式", "门襟装饰", "门襟配色", "门襟方向", "门襟明线", "领型",
      "领尖长尺寸", "领子装饰", "领子配色", "领子明线", "前门扣数", "前门钉扣形式", "前门锁眼形式",
      "肩形", "肩缝明线样式", "肩袢形式", "肩部贴布形式", "裙褶形式", "下摆形式", "下摆配色",
      "下摆明线形式", "前片形式", "后背形式", "过肩形式", "过肩明线", "开衩形式", "里子形式",
      "口袋形式", "口袋位置", "口袋明线", "袋口锁钉形式", "袋盖形式", "腰部形式", "拉链形式",
      "袖扣形式", "领台", "领台扣锁眼形式", "飘带款式", "胸省形式", "胸袋形式", "腰带形式"
    ]
  };

  const prefixMap = {
    "上衣": ["POLO-", "T恤-", "休闲衬衣-", "夹克-", "风衣-", "卫衣-"],
    "裤子": ["卫裤-", "牛仔裤-", "工装裤-", "休闲裤-", "运动裤-"],
    "半裙": ["半裙-"],
    "连衣裙": ["连衣裙-"]
  };

  // ✅ 获取标签所属大类
  function getCategory(label) {
    for (let cat of labelOrder) {
      if (prefixMap[cat].some(pfx => label.startsWith(pfx))) return cat;
    }
    return null;
  }

  // ✅ 判断主描述(SS/男/女/AW)
  function isMainDesc(label) {
    return /SS|AW|男|女/.test(label);
  }

  // ✅ 是否是服装类项目
  function detectIsClothing(labels) {
    return labels.some(lbl =>
      Object.values(prefixMap).some(pfxList =>
        pfxList.some(pfx => lbl.startsWith(pfx))
      )
    );
  }

  // ✅ 服装类排序核心
  function sortClothingLabels(labels) {
    const matched = labelOrder.reduce((acc, cat) => {
      acc[cat] = [];
      return acc;
    }, {});
    const unmatched = [];

    labels.forEach(label => {
      const cat = getCategory(label);
      if (cat) {
        matched[cat].push(label);
      } else {
        unmatched.push(label);
      }
    });

    const finalOrder = [];
    for (let cat of labelOrder) {
      let catLabels = matched[cat];
      if (catLabels.length) {
        // 主描述放最前
        const mainDesc = catLabels.find(isMainDesc);
        if (mainDesc) {
          finalOrder.push(mainDesc);
          catLabels = catLabels.filter(l => l !== mainDesc);
        }
        // 二级字段顺序
        const orderedFields = [];
        const remaining = [];
        catLabels.forEach(label => {
          const fieldOrder = fieldsMap[cat].findIndex(f => label.includes(f));
          if (fieldOrder >= 0) {
            orderedFields.push({ label, order: fieldOrder });
          } else {
            remaining.push(label);
          }
        });
        orderedFields.sort((a, b) => a.order - b.order);
        finalOrder.push(...orderedFields.map(o => o.label));
        finalOrder.push(...remaining);
      }
    }
    // 其他不匹配的放最后
    finalOrder.push(...unmatched);
    return finalOrder;
  }

  // ✅ 绑定现有的“标签排序”按钮
  const sortBtn = document.getElementById("batchSortBtn");
  if (!sortBtn) {
    console.warn("⚠️ 没找到 #batchSortBtn 按钮，请确认 HTML 是否已添加");
    return;
  }

  sortBtn.addEventListener("click", () => {
    if (!currentImage || !currentImage.objects) {
      alert("❌ 当前没有标注数据");
      return;
    }

    const labels = currentImage.objects.map(o => o.label);
    if (!labels.length) {
      alert("⚠️ 没有可排序的标签");
      return;
    }

    const isClothing = detectIsClothing(labels);

    if (!isClothing) {
      alert("⚠️ 当前项目不是服装类，跳过排序");
      return;
    }

    const sortedLabels = sortClothingLabels(labels);

    const newObjects = [];
    sortedLabels.forEach(lbl => {
      const obj = currentImage.objects.find(o => o.label === lbl && !o.__used);
      if (obj) {
        obj.__used = true;
        newObjects.push(obj);
      }
    });
    currentImage.objects.forEach(o => {
      if (!o.__used) newObjects.push(o);
      delete o.__used;
    });

    currentImage.objects = newObjects;
    updateMarkedLabels();
    alert("✅ 标签已按服装规则排序");
  });
});
