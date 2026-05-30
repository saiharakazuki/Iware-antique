const STORAGE_KEY = "iware-antique-flow-v1";
const PROGRESS_KEY = "iware-antique-progress-v1";
const WAREHOUSES = [
  { name: "多治見の倉庫", image: "warehouse-photo-tajimi" },
];
const CATEGORIES = ["チェア", "ソファー", "チェスターソファー", "テーブル", "キャビネット", "チェスト", "シャンデリア", "小物", "その他"];
const config = window.IWARE_CONFIG || {};
const photoBucket = config.photoBucket || "iware-photos";
const supabaseClient =
  config.supabaseUrl &&
  config.supabaseAnonKey &&
  window.supabase?.createClient(config.supabaseUrl, config.supabaseAnonKey);

const state = {
  screen: "top",
  items: loadLocalItems(),
  seenProgress: loadSeenProgress(),
  recentUploadIds: [],
  selectedStockWarehouse: "",
  selectedStockCategory: CATEGORIES[0],
  inventoryWarehouse: "",
  inventoryCategory: CATEGORIES[0],
  missingPriceIds: new Set(),
  pricingDrafts: new Map(),
  uncheckedReviewIds: new Set(),
  reviewMessage: "",
  cloudReady: Boolean(supabaseClient),
  isClearingReview: false,
  isUploading: false,
  activeWrites: 0,
};

const screens = {
  top: document.querySelector("#topScreen"),
  home: document.querySelector("#homeScreen"),
  upload: document.querySelector("#uploadScreen"),
  inventory: document.querySelector("#inventoryScreen"),
  pricing: document.querySelector("#pricingScreen"),
  received: document.querySelector("#receivedScreen"),
};

const homeButton = document.querySelector("#homeButton");
const photoInput = document.querySelector("#photoInput");
const uploadFeedback = document.querySelector("#uploadFeedback");
const uploadPreview = document.querySelector("#uploadPreview");
const uploadCompleteButton = document.querySelector("#uploadCompleteButton");
const uploadActions = document.querySelector("#uploadActions");
const stockDestinationPanel = document.querySelector("#stockDestinationPanel");
const warehouseGrid = document.querySelector("#warehouseGrid");
const categoryGrid = document.querySelector("#categoryGrid");
const inventoryWarehouseGrid = document.querySelector("#inventoryWarehouseGrid");
const inventoryCategoryGrid = document.querySelector("#inventoryCategoryGrid");
const inventoryGrid = document.querySelector("#inventoryGrid");
const pricingGrid = document.querySelector("#pricingGrid");
const receivedGrid = document.querySelector("#receivedGrid");
const noticeBar = document.querySelector("#noticeBar");
const photoTemplate = document.querySelector("#photoTemplate");
const pricingStatus = document.querySelector("#pricingStatus");
const receivedStatus = document.querySelector("#receivedStatus");
const stockStatus = document.querySelector("#stockStatus");
const progressPricingCard = document.querySelector("#progressPricingCard");
const progressReviewCard = document.querySelector("#progressReviewCard");
const progressStockCard = document.querySelector("#progressStockCard");
const progressPricingCount = document.querySelector("#progressPricingCount");
const progressReviewCount = document.querySelector("#progressReviewCount");
const progressStockCount = document.querySelector("#progressStockCount");
const clearReceivedButton = document.querySelector("#clearReceivedButton");
const sendAllButton = document.querySelector("#sendAllButton");
const sendFeedback = document.querySelector("#sendFeedback");
const reviewFeedback = document.querySelector("#reviewFeedback");

homeButton.addEventListener("click", () => {
  setScreen("top");
});

document.querySelectorAll("[data-screen]").forEach((button) => {
  button.dataset.boundClick = "true";
  button.addEventListener("click", () => {
    if (!button.dataset.screen) return;
    setScreen(button.dataset.screen);
  });
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-screen]");
  if (!button || button.disabled) return;
  if (button.dataset.boundClick === "true") return;
  setScreen(button.dataset.screen);
});

photoInput.addEventListener("change", async () => {
  const files = Array.from(photoInput.files || []);
  if (!files.length || state.isUploading) return;

  const nextNumber = state.items.length + 1;
  const newItems = [];
  state.recentUploadIds = [];
  state.isUploading = true;
  photoInput.disabled = true;
  uploadCompleteButton.hidden = true;
  uploadActions.hidden = true;
  stockDestinationPanel.hidden = true;
  uploadFeedback.textContent = "アップロードを開始します...";
  uploadFeedback.hidden = false;

  try {
    for (const [index, file] of files.entries()) {
      uploadFeedback.textContent = `${index + 1}/${files.length}枚をアップロード中...`;

      const photo = await resizeImage(file);
      const title = `PHOTO ${String(nextNumber + index).padStart(3, "0")}`;
      const item = state.cloudReady
        ? await uploadCloudItem(file, photo, title)
        : {
            id: crypto.randomUUID(),
            title,
            photo,
            price: "",
            status: "waiting",
            createdAt: new Date().toISOString(),
          };

      newItems.unshift(item);
      state.recentUploadIds.unshift(item.id);
      state.items = [item, ...state.items];
      renderUploadPreview(newItems);
      renderHomeStatus();
      saveItems();
    }

    photoInput.value = "";
    uploadFeedback.textContent = `${newItems.length}枚アップロードしました。Pricingで金額を入れてください。`;
    uploadFeedback.hidden = false;
    uploadCompleteButton.hidden = false;
    renderUploadPreview(newItems);
    saveItems();
    render();
  } catch (error) {
    console.error(error);
    uploadFeedback.textContent = newItems.length
      ? `${newItems.length}枚は保存できました。残りはもう一度試してください。`
      : "アップロードに失敗しました。通信状態を確認してもう一度試してください。";
    uploadFeedback.hidden = false;
  } finally {
    state.isUploading = false;
    photoInput.disabled = false;
  }
});

uploadCompleteButton.addEventListener("click", () => {
  resetUploadDesk();
  setScreen("home");
});

function resetUploadDesk() {
  uploadPreview.innerHTML = "";
  uploadFeedback.hidden = true;
  uploadFeedback.textContent = "";
  uploadCompleteButton.hidden = true;
  uploadActions.hidden = true;
  stockDestinationPanel.hidden = true;
  photoInput.value = "";
  state.recentUploadIds = [];
}

sendAllButton.addEventListener("click", async () => {
  const entries = Array.from(pricingGrid.querySelectorAll(".item-card"))
    .map(readPricingCard)
    .filter(Boolean);
  if (!entries.length) return;

  const missingEntries = entries.filter((entry) => !entry.price);
  if (missingEntries.length) {
    state.missingPriceIds = new Set(missingEntries.map((entry) => entry.item.id));
    sendFeedback.textContent = `${missingEntries.length}件の金額が未入力です。`;
    sendFeedback.hidden = false;
    renderPricing();
    return;
  }

  sendAllButton.disabled = true;
  sendAllButton.textContent = "送信中...";
  sendFeedback.textContent = "まとめて送信しています...";
  sendFeedback.hidden = false;

  try {
    await Promise.all(
      entries.map((entry) => {
        const fields = makePricingFields(entry.item, entry.price, entry.destination, entry.category);
        return persistItem(entry.item, fields);
      }),
    );
  } catch (error) {
    console.error(error);
    sendFeedback.textContent = "一括送信に失敗しました。もう一度押してください。";
    sendAllButton.disabled = false;
    sendAllButton.textContent = "一括で完了";
    return;
  }

  state.missingPriceIds.clear();
  entries.forEach((entry) => state.pricingDrafts.delete(entry.item.id));
  sendFeedback.textContent = `${entries.length}件を送信しました。`;
  sendFeedback.hidden = false;
  renderHomeStatus();
  render();
});

clearReceivedButton.addEventListener("click", async () => {
  const reviewItems = state.items.filter((item) => isReviewItem(item));
  if (!reviewItems.length) return;

  const uncheckedItems = reviewItems.filter((item) => item.status !== "registered");
  if (uncheckedItems.length) {
    state.uncheckedReviewIds = new Set(uncheckedItems.map((item) => item.id));
    state.reviewMessage = `${uncheckedItems.length}件まだチェックされていません。`;
    render();
    alert("まだチェックしていない写真があります。");
    return;
  }
  state.isClearingReview = true;
  clearReceivedButton.disabled = true;
  const legacyReviewItems = [];
  const stockReviewItems = [];
  reviewItems.forEach((item) => {
    const stockInfo = parseStockTitle(item.title);
    if (stockInfo) {
      stockReviewItems.push({ item, stockInfo });
    } else {
      legacyReviewItems.push(item);
    }
  });

  const deletedIds = new Set(legacyReviewItems.map((item) => item.id));
  stockReviewItems.forEach(({ item, stockInfo }) => {
    item.title = makeStockTitle(stockInfo.warehouse, stockInfo.category, "stock", stockInfo.label);
    item.status = "sent";
    item.registeredAt = "";
  });
  state.items = state.items.filter((item) => !deletedIds.has(item.id));
  state.uncheckedReviewIds.clear();
  state.reviewMessage = "Reviewを完了しました。在庫リストには残っています。";
  saveItems();
  render();

  try {
    await Promise.all(
      stockReviewItems.map(({ item }) =>
        persistItem(item, {
          title: item.title,
          status: item.status,
          registeredAt: item.registeredAt,
        }),
      ),
    );
    await deleteCloudItems(legacyReviewItems);
  } catch (error) {
    console.error(error);
    state.reviewMessage = "画面は更新しました。通信が弱い場合は再読み込みして確認してください。";
    render();
  } finally {
    state.isClearingReview = false;
    clearReceivedButton.disabled = false;
  }
});

function setScreen(screen) {
  markProgressSeen(screen);
  state.screen = screen;
  if (screen !== "received") {
    state.reviewMessage = "";
    state.uncheckedReviewIds.clear();
  }
  render();
}

function loadSeenProgress() {
  try {
    return { waiting: 0, review: 0, stock: 0, ...JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}") };
  } catch {
    return { waiting: 0, review: 0, stock: 0 };
  }
}

function saveSeenProgress() {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(state.seenProgress));
}

function markProgressSeen(screen) {
  const waitingCount = state.items.filter((item) => item.status === "waiting").length;
  const reviewCount = state.items.filter((item) => isReviewItem(item)).length;
  const stockCount = state.items.filter((item) => isStockItem(item)).length;

  if (screen === "pricing") state.seenProgress.waiting = waitingCount;
  if (screen === "received") state.seenProgress.review = reviewCount;
  if (screen === "inventory") state.seenProgress.stock = stockCount;
  saveSeenProgress();
}

function loadLocalItems() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]").map(normalizeItem);
  } catch {
    return [];
  }
}

function saveItems() {
  if (state.cloudReady) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.items));
}

function normalizeItem(item, index) {
  const hasPrice = Boolean(item.price);
  return {
    id: item.id || crypto.randomUUID(),
    title: item.title || `PHOTO ${String(index + 1).padStart(3, "0")}`,
    photo: item.photo || item.photos?.[0] || "",
    photoPath: item.photoPath || "",
    price: item.price || "",
    status: item.status || (hasPrice ? "sent" : "waiting"),
    createdAt: item.createdAt || new Date().toISOString(),
    sentAt: item.sentAt || (hasPrice ? item.createdAt : ""),
    registeredAt: item.registeredAt || "",
  };
}

function makeStockTitle(warehouse, category, routeOrTitle, maybeTitle) {
  const route = maybeTitle ? routeOrTitle : "stock";
  const title = maybeTitle || routeOrTitle;
  return `STOCK｜${warehouse}｜${category}｜${route}｜${title}`;
}

function normalizeWarehouseName(warehouse) {
  return warehouse === "田島倉庫" || warehouse === "田島の倉庫" || warehouse === "タジミ倉庫" || warehouse === "多治見倉庫"
    ? "多治見の倉庫"
    : warehouse;
}

function parseStockTitle(title) {
  const parts = String(title || "").split("｜");
  if (parts[0] !== "STOCK") return null;
  const hasRoute = parts[3] === "review" || parts[3] === "stock";
  return {
    warehouse: normalizeWarehouseName(parts[1] || WAREHOUSES[0].name),
    category: parts[2] || CATEGORIES[0],
    route: hasRoute ? parts[3] : "stock",
    label: parts.slice(hasRoute ? 4 : 3).join("｜") || "PHOTO",
  };
}

function isStockItem(item) {
  return Boolean(parseStockTitle(item.title)) || item.status === "stock";
}

function isReviewItem(item) {
  const stockInfo = parseStockTitle(item.title);
  if (stockInfo?.route === "review") return item.status === "sent" || item.status === "registered";
  return !stockInfo && (item.status === "sent" || item.status === "registered");
}

async function loadCloudItems() {
  if (isSyncBusy()) return;
  if (state.screen === "pricing" && pricingGrid.contains(document.activeElement)) return;

  const { data, error } = await supabaseClient
    .from("inventory_items")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  state.items = data.map(fromCloudItem);
  render();
}

async function uploadCloudItem(file, photo, title, status = "waiting") {
  return withRemoteWrite(async () => {
    const photoPath = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.jpg`;
    const resizedBlob = await dataUrlToBlob(photo);
    const uploadResult = await supabaseClient.storage.from(photoBucket).upload(photoPath, resizedBlob, {
      contentType: "image/jpeg",
    });

    if (uploadResult.error) throw uploadResult.error;

    const { data: publicUrlData } = supabaseClient.storage.from(photoBucket).getPublicUrl(photoPath);
    const { data, error } = await supabaseClient
      .from("inventory_items")
      .insert({
        title,
        photo_url: publicUrlData.publicUrl,
        photo_path: photoPath,
        status,
      })
      .select()
      .single();

    if (error) throw error;
    return fromCloudItem(data);
  });
}

async function updateCloudItem(item, fields) {
  if (!state.cloudReady) return;
  const { error } = await supabaseClient.from("inventory_items").update(toCloudFields(fields)).eq("id", item.id);
  if (error) throw error;
}

async function deleteCloudItems(items) {
  if (!state.cloudReady || !items.length) return;
  return withRemoteWrite(async () => {
    const photoPaths = items.map((item) => item.photoPath).filter(Boolean);
    const itemIds = items.map((item) => item.id);

    const { error } = await supabaseClient.from("inventory_items").delete().in("id", itemIds);
    if (error) throw error;

    if (photoPaths.length) {
      const { error: storageError } = await supabaseClient.storage.from(photoBucket).remove(photoPaths);
      if (storageError) console.warn(storageError);
    }
  });
}

async function persistItem(item, fields) {
  Object.assign(item, fields);
  saveItems();
  await withRemoteWrite(() => updateCloudItem(item, fields));
}

function isSyncBusy() {
  return state.isUploading || state.isClearingReview || state.activeWrites > 0;
}

async function withRemoteWrite(action) {
  state.activeWrites += 1;
  try {
    return await action();
  } finally {
    state.activeWrites = Math.max(0, state.activeWrites - 1);
  }
}

function toCloudFields(fields) {
  const mapped = {};
  if ("title" in fields) mapped.title = fields.title;
  if ("price" in fields) mapped.price = fields.price;
  if ("status" in fields) mapped.status = fields.status;
  if ("sentAt" in fields) mapped.sent_at = fields.sentAt || null;
  if ("registeredAt" in fields) mapped.registered_at = fields.registeredAt || null;
  return mapped;
}

function fromCloudItem(item) {
  return normalizeItem({
    id: item.id,
    title: item.title,
    photo: item.photo_url,
    photoPath: item.photo_path,
    price: item.price,
    status: item.status,
    createdAt: item.created_at,
    sentAt: item.sent_at,
    registeredAt: item.registered_at,
  });
}

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const maxSize = 1100;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);

        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      image.onerror = () => reject(new Error("写真を読み込めませんでした。"));
      image.src = reader.result;
    };
    reader.onerror = () => reject(new Error("写真を読み込めませんでした。"));
    reader.readAsDataURL(file);
  });
}

function render() {
  renderHomeStatus();

  Object.entries(screens).forEach(([name, element]) => {
    element.hidden = state.screen !== name;
  });

  renderPricing();
  renderReceived();
  renderInventory();
}

function renderDestinationPickers() {
  warehouseGrid.innerHTML = "";
  categoryGrid.innerHTML = "";
  categoryGrid.hidden = false;
  state.selectedStockWarehouse ||= WAREHOUSES[0].name;
  state.selectedStockCategory ||= CATEGORIES[0];

  const warehouseLabel = document.createElement("label");
  warehouseLabel.className = "select-label";
  warehouseLabel.innerHTML = `
    <span>どこの在庫表に入れますか</span>
    <select class="stock-select" id="stockWarehouseSelect">
      ${WAREHOUSES.map(
        (warehouse) => `<option value="${warehouse.name}" ${warehouse.name === state.selectedStockWarehouse ? "selected" : ""}>${warehouse.name}</option>`,
      ).join("")}
    </select>
  `;

  const categoryLabel = document.createElement("label");
  categoryLabel.className = "select-label";
  categoryLabel.innerHTML = `
    <span>カテゴリ</span>
    <select class="stock-select" id="stockCategorySelect">
      ${CATEGORIES.map(
        (category) => `<option value="${category}" ${category === state.selectedStockCategory ? "selected" : ""}>${category}</option>`,
      ).join("")}
    </select>
  `;

  const saveButton = document.createElement("button");
  saveButton.className = "complete-button stock-save-button";
  saveButton.type = "button";
  saveButton.textContent = "この在庫表に入れる";

  warehouseGrid.append(warehouseLabel);
  categoryGrid.append(categoryLabel, saveButton);

  warehouseLabel.querySelector("select").addEventListener("change", (event) => {
    state.selectedStockWarehouse = event.target.value;
  });
  categoryLabel.querySelector("select").addEventListener("change", (event) => {
    state.selectedStockCategory = event.target.value;
  });
  saveButton.addEventListener("click", () => sendRecentUploadsToStock(state.selectedStockWarehouse, state.selectedStockCategory));
}

async function sendRecentUploadsToStock(warehouse, category) {
  const recentItems = state.items.filter((item) => state.recentUploadIds.includes(item.id));
  if (!recentItems.length) return;

  uploadActions.hidden = true;
  stockDestinationPanel.hidden = true;
  uploadFeedback.textContent = `${warehouse} / ${category} に入れています...`;
  uploadFeedback.hidden = false;

  try {
    await Promise.all(
      recentItems.map((item) =>
        persistItem(item, {
          title: makeStockTitle(warehouse, category, item.title),
          status: "sent",
          price: "",
        }),
      ),
    );
    uploadFeedback.textContent = `${warehouse} / ${category} に保存しました。`;
    uploadCompleteButton.hidden = false;
    renderHomeStatus();
  } catch (error) {
    console.error(error);
    uploadFeedback.textContent = "在庫表への保存に失敗しました。もう一度試してください。";
  }
}

function renderUploadPreview(items) {
  uploadPreview.innerHTML = "";

  items.slice(0, 8).forEach((item) => {
    const image = document.createElement("img");
    image.src = item.photo;
    image.alt = `${item.title} thumbnail`;
    uploadPreview.append(image);
  });
}

function markPricingAsSent() {
  pricingGrid.querySelectorAll(".item-card").forEach((card) => {
    card.classList.add("is-registered");
    const button = card.querySelector(".send-price-button");
    const input = card.querySelector(".price-input");
    const badge = card.querySelector(".status-badge");
    if (button) {
      button.textContent = "Sent";
      button.disabled = true;
    }
    if (input) {
      input.disabled = true;
    }
    if (badge) {
      badge.textContent = "Sent";
      badge.classList.add("is-priced");
    }
  });
}

function renderHomeStatus() {
  const waitingCount = state.items.filter((item) => item.status === "waiting").length;
  const reviewCount = state.items.filter((item) => isReviewItem(item)).length;
  const stockCount = state.items.filter((item) => isStockItem(item)).length;

  pricingStatus.textContent = waitingCount ? `${waitingCount}件あり` : "待機中";
  receivedStatus.textContent = reviewCount ? `${reviewCount}件届いています` : "通知なし";
  stockStatus.textContent = stockCount ? `${stockCount}件` : "Stock list";
  pricingStatus.closest(".home-card").classList.toggle("has-motion", waitingCount > 0);
  receivedStatus.closest(".home-card").classList.toggle("has-motion", reviewCount > 0);

  if (progressPricingCount) {
    progressPricingCount.textContent = waitingCount;
    progressReviewCount.textContent = reviewCount;
    progressStockCount.textContent = stockCount;
    updateProgressCard(progressPricingCard, waitingCount, state.seenProgress.waiting);
    updateProgressCard(progressReviewCard, reviewCount, state.seenProgress.review);
    updateProgressCard(progressStockCard, stockCount, state.seenProgress.stock);
  }
}

function updateProgressCard(card, count, seenCount) {
  if (!card) return;
  const hasNew = count > seenCount;
  card.classList.toggle("has-new", hasNew);
  card.classList.toggle("is-muted", !hasNew);
}

function renderInventory() {
  if (!inventoryWarehouseGrid || !inventoryCategoryGrid || !inventoryGrid) return;

  inventoryWarehouseGrid.innerHTML = "";
  inventoryCategoryGrid.innerHTML = "";

  if (state.inventoryWarehouse) {
    const backButton = document.createElement("button");
    backButton.className = "pill-button warehouse-list-back";
    backButton.type = "button";
    backButton.textContent = "倉庫一覧へ戻る";
    backButton.addEventListener("click", () => {
      state.inventoryWarehouse = "";
      renderInventory();
    });

    const title = document.createElement("div");
    title.className = "warehouse-detail-title";
    title.innerHTML = `<span>Selected warehouse</span><strong>${state.inventoryWarehouse}</strong>`;
    inventoryWarehouseGrid.append(backButton, title);
    inventoryWarehouseGrid.classList.add("is-detail");
  } else {
    inventoryWarehouseGrid.classList.remove("is-detail");
  }

  if (state.inventoryWarehouse) {
    inventoryCategoryGrid.hidden = false;
    CATEGORIES.forEach((category, index) => {
      const count = state.items.filter((item) => {
        const stock = parseStockTitle(item.title);
        return isStockItem(item) && stock?.warehouse === state.inventoryWarehouse && stock?.category === category;
      }).length;
      const button = document.createElement("button");
      button.className = "pill-button category-button";
      button.type = "button";
      button.innerHTML = `
        <span class="category-number">${String(index + 1).padStart(2, "0")}</span>
        <span class="category-copy"><strong>${category}</strong><small>${count} items</small></span>
        <em>見る</em>
      `;
      button.classList.toggle("is-active", state.inventoryCategory === category);
      button.addEventListener("click", () => {
        state.inventoryCategory = category;
        renderInventory();
      });
      inventoryCategoryGrid.append(button);
    });

    const stockItems = state.items.filter((item) => {
      const stock = parseStockTitle(item.title);
      return isStockItem(item) && stock?.warehouse === state.inventoryWarehouse && stock?.category === state.inventoryCategory;
    });
    renderGrid(inventoryGrid, stockItems, "stock", "このカテゴリの在庫写真はありません。");
    return;
  }

  WAREHOUSES.forEach((warehouse) => {
    const count = state.items.filter((item) => isStockItem(item) && parseStockTitle(item.title)?.warehouse === warehouse.name).length;
    const button = document.createElement("button");
    button.className = "pill-button warehouse-button";
    button.type = "button";
    button.innerHTML = `
      <span class="warehouse-photo ${warehouse.image}" aria-hidden="true"></span>
      <span class="warehouse-name">${warehouse.name}</span>
      <em>${count}件</em>
    `;
    button.classList.toggle("is-active", state.inventoryWarehouse === warehouse.name);
    button.addEventListener("click", () => {
      state.inventoryWarehouse = warehouse.name;
      state.inventoryCategory = CATEGORIES[0];
      renderInventory();
    });
    inventoryWarehouseGrid.append(button);
  });

  inventoryCategoryGrid.hidden = true;
  renderGrid(inventoryGrid, [], "stock", "倉庫を選んでください。");
}

function renderPricing() {
  const waitingItems = state.items.filter((item) => item.status === "waiting");
  sendAllButton.hidden = waitingItems.length === 0;
  sendAllButton.disabled = false;
  sendAllButton.textContent = "一括で完了";
  renderGrid(pricingGrid, waitingItems, "pricing", "金額待ちの写真はありません。");
}

function renderReceived() {
  const reviewItems = state.items.filter((item) => isReviewItem(item));
  noticeBar.hidden = reviewItems.length === 0;
  clearReceivedButton.hidden = reviewItems.length === 0;
  clearReceivedButton.disabled = state.isClearingReview;
  clearReceivedButton.textContent = state.isClearingReview ? "削除中..." : "完了";
  reviewFeedback.hidden = !state.reviewMessage;
  reviewFeedback.textContent = state.reviewMessage;
  renderGrid(receivedGrid, reviewItems, "received", "価格付きの写真はありません。");
}

function renderGrid(container, items, mode, emptyText) {
  container.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = emptyText;
    container.append(empty);
    return;
  }

  items.forEach((item) => container.append(renderItem(item, mode)));
}

function readPricingCard(card) {
  const item = state.items.find((candidate) => candidate.id === card.dataset.itemId);
  if (!item) return null;
  const entry = {
    item,
    card,
    price: card.querySelector(".price-input")?.value.trim() || "",
    destination: card.querySelector(".destination-select")?.value || "review",
    category: card.querySelector(".stock-category-select")?.value || CATEGORIES[0],
  };
  updatePricingDraft(item.id, {
    price: entry.price,
    destination: entry.destination,
    category: entry.category,
  });
  return entry;
}

function makePricingFields(item, price, destination, category) {
  const stockInfo = parseStockTitle(item.title);
  const sendToStock = destination === "stock";
  const sentAt = new Date().toISOString();
  return {
    title: makeStockTitle(WAREHOUSES[0].name, category, sendToStock ? "stock" : "review", stockInfo?.label || item.title),
    price,
    status: "sent",
    sentAt: sendToStock ? "" : sentAt,
  };
}

function getPricingDraft(item) {
  return {
    price: item.price || "",
    destination: "review",
    category: CATEGORIES[0],
    ...(state.pricingDrafts.get(item.id) || {}),
  };
}

function updatePricingDraft(itemId, fields) {
  state.pricingDrafts.set(itemId, {
    ...(state.pricingDrafts.get(itemId) || {}),
    ...fields,
  });
}

function renderItem(item, mode) {
  const card = photoTemplate.content.firstElementChild.cloneNode(true);
  const image = card.querySelector("img");
  const title = card.querySelector("h3");
  const badge = card.querySelector(".status-badge");
  const priceRow = card.querySelector(".price-row");
  const priceInput = card.querySelector(".price-input");
  const destinationSelect = card.querySelector(".destination-select");
  const categoryField = card.querySelector(".stock-category-field");
  const categorySelect = card.querySelector(".stock-category-select");
  const sendButton = card.querySelector(".send-price-button");
  const receivedPrice = card.querySelector(".received-price");
  const reviewCheck = card.querySelector(".review-check");
  const reviewCheckbox = card.querySelector(".review-checkbox");
  const deleteButton = card.querySelector(".delete-button");
  const time = card.querySelector("time");

  card.dataset.itemId = item.id;
  image.src = item.photo;
  image.alt = `${item.title} の写真`;
  const stockInfo = parseStockTitle(item.title);
  title.textContent = stockInfo?.label || item.title;
  priceInput.value = item.price || "";
  if (categorySelect) {
    categorySelect.innerHTML = CATEGORIES.map((category) => `<option value="${category}">${category}</option>`).join("");
  }
  time.dateTime = item.createdAt;
  time.textContent = formatDate(item.status === "sent" ? item.sentAt : item.createdAt);

  if (mode === "pricing") {
    const draft = getPricingDraft(item);
    priceInput.value = draft.price;
    destinationSelect.value = draft.destination;
    categorySelect.value = draft.category;
    badge.textContent = "Ready";
    receivedPrice.hidden = true;
    reviewCheck.hidden = true;
    deleteButton.hidden = true;
    categoryField.hidden = false;
    destinationSelect.addEventListener("change", () => {
      updatePricingDraft(item.id, { destination: destinationSelect.value });
    });
    categorySelect.addEventListener("change", () => {
      updatePricingDraft(item.id, { category: categorySelect.value });
    });
    card.classList.toggle("is-missing", state.missingPriceIds.has(item.id));
    sendButton.addEventListener("click", () => {
      const entry = readPricingCard(card);
      if (!entry?.price) {
        state.missingPriceIds.add(item.id);
        card.classList.add("is-missing");
        priceInput.focus();
        return;
      }
      const sendToStock = entry.destination === "stock";
      const fields = makePricingFields(item, entry.price, entry.destination, entry.category);
      state.missingPriceIds.delete(item.id);
      sendButton.textContent = "Sent";
      sendButton.disabled = true;
      persistItem(item, fields)
        .then(() => {
          state.pricingDrafts.delete(item.id);
          state.items = state.items.filter((candidate) => candidate.id !== item.id);
          state.items.unshift(item);
          render();
        })
        .catch(console.error);
      renderHomeStatus();
      card.classList.add("is-registered");
      priceInput.disabled = true;
      destinationSelect.disabled = true;
      categorySelect.disabled = true;
      badge.textContent = "Sent";
      badge.classList.add("is-priced");
      sendFeedback.textContent = sendToStock
        ? `${entry.category} として在庫に入れました。`
        : `${item.title} をReviewへ送信しました。`;
      sendFeedback.hidden = false;
    });

    priceInput.addEventListener("input", () => {
      item.price = priceInput.value.trim();
      updatePricingDraft(item.id, { price: item.price });
      if (item.price) {
        state.missingPriceIds.delete(item.id);
        card.classList.remove("is-missing");
      }
      persistItem(item, { price: item.price }).catch(console.error);
    });

    priceInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        sendButton.click();
      }
    });
  }

  if (mode === "received") {
    const isRegistered = item.status === "registered";
    badge.textContent = isRegistered ? "Registered" : "Priced";
    badge.classList.add("is-priced");
    card.classList.toggle("is-registered", isRegistered);
    card.classList.toggle("is-unchecked", state.uncheckedReviewIds.has(item.id));
    priceRow.hidden = true;
    if (destinationSelect) destinationSelect.hidden = true;
    if (categoryField) categoryField.hidden = true;
    deleteButton.hidden = false;
    deleteButton.disabled = false;
    receivedPrice.hidden = false;
    receivedPrice.textContent = `¥${Number(item.price).toLocaleString("ja-JP")}`;
    reviewCheckbox.checked = isRegistered;
    reviewCheckbox.addEventListener("change", async () => {
      const previousStatus = item.status;
      const previousRegisteredAt = item.registeredAt;
      const nextStatus = reviewCheckbox.checked ? "registered" : "sent";
      const nextRegisteredAt = reviewCheckbox.checked ? new Date().toISOString() : "";
      reviewCheckbox.disabled = true;

      item.status = nextStatus;
      item.registeredAt = nextRegisteredAt;
      state.uncheckedReviewIds.delete(item.id);
      state.reviewMessage = reviewCheckbox.checked ? `${item.title} を完了しました。` : "";
      render();

      try {
        await persistItem(item, { status: nextStatus, registeredAt: nextRegisteredAt });
      } catch (error) {
        console.error(error);
        item.status = previousStatus;
        item.registeredAt = previousRegisteredAt;
        state.reviewMessage = "チェックの保存に失敗しました。もう一度押してください。";
        render();
      }
    });
  }

  if (mode === "stock") {
    badge.textContent = stockInfo?.route === "review" ? "Review" : "在庫";
    badge.classList.add("is-priced");
    priceRow.hidden = true;
    if (destinationSelect) destinationSelect.hidden = true;
    if (categoryField) categoryField.hidden = true;
    receivedPrice.hidden = false;
    receivedPrice.textContent = item.price ? `¥${Number(item.price).toLocaleString("ja-JP")}` : "価格未入力";
    time.textContent = stockInfo?.warehouse || "在庫";
    reviewCheck.hidden = true;
    deleteButton.hidden = false;
    deleteButton.disabled = false;
  }

  deleteButton.addEventListener("click", async () => {
    const label = stockInfo?.label || item.title;
    if (!confirm(`${label} を削除してもいいですか？`)) return;

    deleteButton.disabled = true;
    const previousItems = [...state.items];
    state.items = state.items.filter((candidate) => candidate.id !== item.id);
    saveItems();
    render();

    try {
      await deleteCloudItems([item]);
    } catch (error) {
      console.error(error);
      state.items = previousItems;
      state.reviewMessage = "削除に失敗しました。もう一度押してください。";
      render();
    }
  });

  return card;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value || new Date()));
}

render();

if (state.cloudReady) {
  loadCloudItems();
  setInterval(loadCloudItems, 10000);
}
