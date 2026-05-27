const STORAGE_KEY = "iware-antique-flow-v1";
const config = window.IWARE_CONFIG || {};
const photoBucket = config.photoBucket || "iware-photos";
const supabaseClient =
  config.supabaseUrl &&
  config.supabaseAnonKey &&
  window.supabase?.createClient(config.supabaseUrl, config.supabaseAnonKey);

const state = {
  screen: "home",
  items: loadLocalItems(),
  missingPriceIds: new Set(),
  uncheckedReviewIds: new Set(),
  reviewMessage: "",
  cloudReady: Boolean(supabaseClient),
  isClearingReview: false,
};

const screens = {
  home: document.querySelector("#homeScreen"),
  upload: document.querySelector("#uploadScreen"),
  pricing: document.querySelector("#pricingScreen"),
  received: document.querySelector("#receivedScreen"),
};

const homeButton = document.querySelector("#homeButton");
const photoInput = document.querySelector("#photoInput");
const uploadFeedback = document.querySelector("#uploadFeedback");
const uploadPreview = document.querySelector("#uploadPreview");
const uploadCompleteButton = document.querySelector("#uploadCompleteButton");
const pricingGrid = document.querySelector("#pricingGrid");
const receivedGrid = document.querySelector("#receivedGrid");
const noticeBar = document.querySelector("#noticeBar");
const photoTemplate = document.querySelector("#photoTemplate");
const pricingStatus = document.querySelector("#pricingStatus");
const receivedStatus = document.querySelector("#receivedStatus");
const clearReceivedButton = document.querySelector("#clearReceivedButton");
const sendAllButton = document.querySelector("#sendAllButton");
const sendFeedback = document.querySelector("#sendFeedback");
const reviewFeedback = document.querySelector("#reviewFeedback");

homeButton.addEventListener("click", () => {
  setScreen("home");
});

document.querySelectorAll("[data-screen]").forEach((button) => {
  button.addEventListener("click", () => {
    setScreen(button.dataset.screen);
  });
});

photoInput.addEventListener("change", async () => {
  const files = Array.from(photoInput.files || []);
  if (!files.length) return;

  const nextNumber = state.items.length + 1;
  uploadFeedback.textContent = "Uploading...";
  uploadFeedback.hidden = false;

  try {
    const newItems = await Promise.all(
      files.map(async (file, index) => {
        const photo = await resizeImage(file);
        const title = `PHOTO ${String(nextNumber + index).padStart(3, "0")}`;

        if (state.cloudReady) {
          return uploadCloudItem(file, photo, title);
        }

        return {
          id: crypto.randomUUID(),
          title,
          photo,
          price: "",
          status: "waiting",
          createdAt: new Date().toISOString(),
        };
      }),
    );

    state.items = [...newItems.reverse(), ...state.items];
    photoInput.value = "";
    uploadFeedback.textContent = `${newItems.length} photos uploaded.`;
    uploadFeedback.hidden = false;
    uploadCompleteButton.hidden = false;
    renderUploadPreview(newItems);
    saveItems();
    render();
  } catch (error) {
    console.error(error);
    uploadFeedback.textContent = "Upload failed. Supabase settingsを確認してください。";
    uploadFeedback.hidden = false;
  }
});

uploadCompleteButton.addEventListener("click", () => {
  alert("アップロードしました。戻るでトップへ戻れます。");
});

sendAllButton.addEventListener("click", async () => {
  const waitingItems = state.items.filter((item) => item.status === "waiting");
  const missingItems = waitingItems.filter((item) => !item.price);
  if (missingItems.length) {
    state.missingPriceIds = new Set(missingItems.map((item) => item.id));
    sendFeedback.textContent = `${missingItems.length} prices missing.`;
    sendFeedback.hidden = false;
    renderPricing();
    return;
  }

  const sentAt = new Date().toISOString();
  sendAllButton.disabled = true;
  sendFeedback.textContent = "Sending...";
  sendFeedback.hidden = false;

  try {
    await Promise.all(waitingItems.map((item) => persistItem(item, { status: "sent", sentAt })));
  } catch (error) {
    console.error(error);
    sendFeedback.textContent = "送信に失敗しました。もう一度押してください。";
    sendAllButton.disabled = false;
    return;
  }

  state.missingPriceIds.clear();
  sendFeedback.textContent = `${waitingItems.length} prices sent. 戻るでトップへ戻れます。`;
  sendFeedback.hidden = false;
  saveItems();
  renderHomeStatus();
  markPricingAsSent();
});

clearReceivedButton.addEventListener("click", async () => {
  const reviewItems = state.items.filter((item) => item.status === "sent" || item.status === "registered");
  if (!reviewItems.length) return;

  const uncheckedItems = reviewItems.filter((item) => item.status !== "registered");
  if (uncheckedItems.length) {
    state.uncheckedReviewIds = new Set(uncheckedItems.map((item) => item.id));
    state.reviewMessage = `${uncheckedItems.length} item${uncheckedItems.length === 1 ? "" : "s"} not checked yet.`;
    render();
    alert("まだチェックしていない写真があります。");
    return;
  }
  if (!confirm("全部チェックしましたか？")) return;

  state.isClearingReview = true;
  clearReceivedButton.disabled = true;
  state.reviewMessage = "Clearing...";
  renderReceived();

  try {
    await deleteCloudItems(reviewItems);
  } catch (error) {
    console.error(error);
    state.reviewMessage = "削除に失敗しました。もう一度押してください。";
    state.isClearingReview = false;
    clearReceivedButton.disabled = false;
    renderReceived();
    return;
  }

  const deletedIds = new Set(reviewItems.map((item) => item.id));
  state.items = state.items.filter((item) => !deletedIds.has(item.id));
  state.uncheckedReviewIds.clear();
  state.reviewMessage = "Registered items cleared.";
  state.isClearingReview = false;
  saveItems();
  render();
});

function setScreen(screen) {
  state.screen = screen;
  if (screen !== "received") {
    state.reviewMessage = "";
    state.uncheckedReviewIds.clear();
  }
  render();
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

async function loadCloudItems() {
  if (state.isClearingReview) return;

  const { data, error } = await supabaseClient
    .from("inventory_items")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    state.cloudReady = false;
    render();
    return;
  }

  state.items = data.map(fromCloudItem);
  render();
}

async function uploadCloudItem(file, photo, title) {
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
      status: "waiting",
    })
    .select()
    .single();

  if (error) throw error;
  return fromCloudItem(data);
}

async function updateCloudItem(item, fields) {
  if (!state.cloudReady) return;
  const { error } = await supabaseClient.from("inventory_items").update(toCloudFields(fields)).eq("id", item.id);
  if (error) throw error;
}

async function deleteCloudItems(items) {
  if (!state.cloudReady || !items.length) return;
  const photoPaths = items.map((item) => item.photoPath).filter(Boolean);
  const itemIds = items.map((item) => item.id);

  const { error } = await supabaseClient.from("inventory_items").delete().in("id", itemIds);
  if (error) throw error;

  if (photoPaths.length) {
    const { error: storageError } = await supabaseClient.storage.from(photoBucket).remove(photoPaths);
    if (storageError) console.warn(storageError);
  }
}

async function persistItem(item, fields) {
  Object.assign(item, fields);
  saveItems();
  await updateCloudItem(item, fields);
}

function toCloudFields(fields) {
  const mapped = {};
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
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const maxSize = 1400;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);

        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      image.src = reader.result;
    };
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
  const sentCount = state.items.filter((item) => item.status === "sent").length;
  const registeredCount = state.items.filter((item) => item.status === "registered").length;

  pricingStatus.textContent = waitingCount ? `${waitingCount} uploaded` : "Waiting";
  receivedStatus.textContent = sentCount + registeredCount ? `${sentCount + registeredCount} ready` : "No notice";
  pricingStatus.closest(".home-card").classList.toggle("has-motion", waitingCount > 0);
  receivedStatus.closest(".home-card").classList.toggle("has-motion", sentCount + registeredCount > 0);
}

function renderPricing() {
  const waitingItems = state.items.filter((item) => item.status === "waiting");
  sendAllButton.hidden = waitingItems.length === 0;
  sendAllButton.disabled = false;
  renderGrid(pricingGrid, waitingItems, "pricing", "No photos waiting for price.");
}

function renderReceived() {
  const reviewItems = state.items.filter((item) => item.status === "sent" || item.status === "registered");
  noticeBar.hidden = reviewItems.length === 0;
  clearReceivedButton.hidden = reviewItems.length === 0;
  clearReceivedButton.disabled = state.isClearingReview;
  clearReceivedButton.textContent = state.isClearingReview ? "Clearing..." : "完了";
  reviewFeedback.hidden = !state.reviewMessage;
  reviewFeedback.textContent = state.reviewMessage;
  renderGrid(receivedGrid, reviewItems, "received", "No priced photos yet.");
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

function renderItem(item, mode) {
  const card = photoTemplate.content.firstElementChild.cloneNode(true);
  const image = card.querySelector("img");
  const title = card.querySelector("h3");
  const badge = card.querySelector(".status-badge");
  const priceRow = card.querySelector(".price-row");
  const priceInput = card.querySelector(".price-input");
  const sendButton = card.querySelector(".send-price-button");
  const receivedPrice = card.querySelector(".received-price");
  const reviewCheck = card.querySelector(".review-check");
  const reviewCheckbox = card.querySelector(".review-checkbox");
  const deleteButton = card.querySelector(".delete-button");
  const time = card.querySelector("time");

  image.src = item.photo;
  image.alt = `${item.title} の写真`;
  title.textContent = item.title;
  priceInput.value = item.price || "";
  time.dateTime = item.createdAt;
  time.textContent = formatDate(item.status === "sent" ? item.sentAt : item.createdAt);

  if (mode === "pricing") {
    badge.textContent = "Ready";
    receivedPrice.hidden = true;
    reviewCheck.hidden = true;
    deleteButton.hidden = true;
    card.classList.toggle("is-missing", state.missingPriceIds.has(item.id));
    sendButton.addEventListener("click", () => {
      const price = priceInput.value.trim();
      if (!price) {
        state.missingPriceIds.add(item.id);
        card.classList.add("is-missing");
        priceInput.focus();
        return;
      }
      item.price = price;
      item.status = "sent";
      item.sentAt = new Date().toISOString();
      state.missingPriceIds.delete(item.id);
      sendButton.textContent = "Sent";
      sendButton.disabled = true;
      persistItem(item, { price: item.price, status: item.status, sentAt: item.sentAt }).catch(console.error);
      renderHomeStatus();
      card.classList.add("is-registered");
      priceInput.disabled = true;
      badge.textContent = "Sent";
      badge.classList.add("is-priced");
      sendFeedback.textContent = `${item.title} sent. 戻るでトップへ戻れます。`;
      sendFeedback.hidden = false;
    });

    priceInput.addEventListener("input", () => {
      item.price = priceInput.value.trim();
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
      state.reviewMessage = reviewCheckbox.checked ? `${item.title} checked.` : "";

      try {
        await persistItem(item, { status: nextStatus, registeredAt: nextRegisteredAt });
        render();
      } catch (error) {
        console.error(error);
        item.status = previousStatus;
        item.registeredAt = previousRegisteredAt;
        state.reviewMessage = "チェックの保存に失敗しました。もう一度押してください。";
        render();
      }
    });
  }

  deleteButton.addEventListener("click", async () => {
    if (!confirm(`${item.title} を削除しますか？`)) return;
    deleteButton.disabled = true;

    try {
      await deleteCloudItems([item]);
    } catch (error) {
      console.error(error);
      deleteButton.disabled = false;
      alert("削除に失敗しました。もう一度押してください。");
      return;
    }

    state.items = state.items.filter((candidate) => candidate.id !== item.id);
    saveItems();
    render();
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
