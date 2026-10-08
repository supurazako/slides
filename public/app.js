const list = document.querySelector("#slideList");
const count = document.querySelector("#slideCount");
const emptyState = document.querySelector("#emptyState");
const loadError = document.querySelector("#loadError");

function getHref(value) {
  if (typeof value !== "string" || value.trim() === "") return null;

  try {
    const url = new URL(value, window.location.href);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const filename = url.pathname.split("/").filter(Boolean).pop() ?? "";
    return {
      href: url.href,
      external: url.origin !== window.location.origin,
      extension: filename.includes(".") ? filename.split(".").pop().toUpperCase() : "SLIDE",
    };
  } catch {
    return null;
  }
}

function formatDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function makeCard(slide, index) {
  if (typeof slide?.title !== "string" || slide.title.trim() === "") return null;

  const destination = getHref(slide.href);
  if (!destination) return null;

  const card = document.createElement("a");
  card.className = "card";
  card.href = destination.href;

  if (destination.external) {
    card.target = "_blank";
    card.rel = "noopener noreferrer";
  }

  const preview = document.createElement("div");
  preview.className = "preview";

  const fallback = document.createElement("div");
  fallback.className = "cover-fallback";
  fallback.dataset.tone = String(index % 3);
  fallback.setAttribute("aria-hidden", "true");

  const kicker = document.createElement("span");
  kicker.className = "cover-kicker";
  kicker.textContent = "supurazako / slides";

  const coverTitle = document.createElement("strong");
  coverTitle.className = "cover-title";
  coverTitle.textContent = slide.title;
  fallback.append(kicker, coverTitle);
  preview.append(fallback);

  if (typeof slide.preview === "string" && slide.preview.trim() !== "") {
    const imagePath = getHref(slide.preview);
    if (imagePath) {
      const image = document.createElement("img");
      image.className = "preview-image";
      image.src = imagePath.href;
      image.alt = "";
      image.loading = "lazy";
      image.addEventListener("error", () => image.remove(), { once: true });
      preview.append(image);
    }
  }

  const format = document.createElement("span");
  format.className = "format";
  format.textContent =
    typeof slide.format === "string" && slide.format.trim() !== ""
      ? slide.format.trim().toUpperCase()
      : destination.extension;
  card.setAttribute("aria-label", `${slide.title} (${format.textContent})を開く`);

  const openMark = document.createElement("span");
  openMark.className = "open-mark";
  openMark.textContent = "↗";
  openMark.setAttribute("aria-hidden", "true");
  preview.append(format, openMark);

  const title = document.createElement("h2");
  title.textContent = slide.title;
  card.append(preview, title);

  const displayDate = formatDate(slide.date);
  if (displayDate) {
    const time = document.createElement("time");
    time.dateTime = slide.date;
    time.textContent = displayDate;
    card.append(time);
  }

  return { card, date: slide.date };
}

async function loadSlides() {
  try {
    const response = await fetch("./slides.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("Could not load slides.json");

    const data = await response.json();
    const slides = Array.isArray(data.slides) ? data.slides : [];
    const cards = slides
      .map((slide, index) => makeCard(slide, index))
      .filter(Boolean)
      .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));

    for (const item of cards) list.append(item.card);
    count.textContent = `${cards.length} ${cards.length === 1 ? "SLIDE" : "SLIDES"}`;
    emptyState.hidden = cards.length > 0;
  } catch {
    count.textContent = "—";
    emptyState.hidden = true;
    loadError.hidden = false;
  }
}

loadSlides();
