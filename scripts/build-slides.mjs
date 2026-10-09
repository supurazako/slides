import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readdir, readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(projectRoot, "public");
const slidesDir = path.join(publicDir, "slides");
const decksDir = path.join(publicDir, "decks");
const manualSlidesPath = path.join(projectRoot, "src", "data", "manual-slides.json");
const manifestPath = path.join(projectRoot, "src", "data", "slides.json");
const cachePath = path.join(projectRoot, "src", "data", "slides-cache.json");
const cacheFormatVersion = 1;
const renderPipelineVersion = "pdfinfo-pdftotext-pdftoppm-scale1600-jpegq86-v1";

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error(`Required command not found: ${command}. Install Poppler (macOS: brew install poppler).`);
    }
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} failed: ${(result.stderr || result.stdout || "").trim()}`);
  }

  return result.stdout ?? "";
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return fallback;
    throw error;
  }
}

async function deckPagesExist(slug, pageCount) {
  const checks = await Promise.all(
    Array.from({ length: pageCount }, async (_, index) => {
      const pageName = `page-${String(index + 1).padStart(3, "0")}.jpg`;
      try {
        await access(path.join(decksDir, slug, pageName));
        return true;
      } catch {
        return false;
      }
    }),
  );
  return checks.every(Boolean);
}

function cleanText(value) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function dateFromText(value) {
  const patterns = [
    /(?:^|\D)(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/,
    /(?:^|\D)(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日/,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match) continue;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return undefined;
}

async function findPdfs(directory, relativeDirectory = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const pdfs = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;

    const relativePath = path.join(relativeDirectory, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      pdfs.push(...(await findPdfs(absolutePath, relativePath)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
      pdfs.push({ absolutePath, relativePath });
    }
  }

  return pdfs.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function makeSlug(relativePath, usedSlugs) {
  const baseName = path.basename(relativePath, path.extname(relativePath));
  const readable = baseName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "slide";
  let slug = readable;

  if (usedSlugs.has(slug)) {
    const suffix = createHash("sha1").update(relativePath).digest("hex").slice(0, 7);
    slug = `${readable}-${suffix}`;
  }

  while (usedSlugs.has(slug)) slug = `${slug}-slide`;
  usedSlugs.add(slug);
  return slug;
}

function isGeneratedSlug(value) {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function publicPath(...segments) {
  return `/${segments
    .flatMap((segment) => segment.split(path.sep))
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

async function makeSlide({ absolutePath, relativePath, slug }) {
  const info = run("pdfinfo", [absolutePath]);
  const pageCount = Number(info.match(/^Pages:\s*(\d+)\s*$/m)?.[1]);
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new Error(`Could not read the page count: ${relativePath}`);
  }

  const extractedText = run("pdftotext", ["-f", "1", "-l", String(Math.min(pageCount, 5)), "-layout", absolutePath, "-"]);
  const firstPageText = run("pdftotext", ["-f", "1", "-l", "1", "-layout", absolutePath, "-"]);
  const metadataTitle = info.match(/^Title:\s*(.*)$/m)?.[1]?.trim();
  const firstPageTitle = firstPageText
    .split(/\r?\n/)
    .map(cleanText)
    .find((line) => line.length > 1 && !dateFromText(line));
  const title = cleanText(
    metadataTitle && !/^(?:\(none\)|none)$/i.test(metadataTitle)
      ? metadataTitle
      : firstPageTitle || path.basename(relativePath, path.extname(relativePath)),
  );

  const deckDir = path.join(decksDir, slug);
  await rm(deckDir, { recursive: true, force: true });
  await mkdir(deckDir, { recursive: true });
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const pageName = `page-${String(pageNumber).padStart(3, "0")}.jpg`;
    const outputPrefix = path.join(deckDir, pageName.slice(0, -4));
    run("pdftoppm", [
      "-f", String(pageNumber),
      "-l", String(pageNumber),
      "-scale-to", "1600",
      "-singlefile",
      "-jpeg",
      "-jpegopt", "quality=86",
      absolutePath,
      outputPrefix,
    ]);
    pages.push(publicPath("decks", slug, pageName));
  }

  const slide = {
    slug,
    title,
    format: "PDF",
    href: publicPath("slides", relativePath),
    preview: pages[0],
    pages,
  };
  const date = dateFromText(extractedText);
  if (date) slide.date = date;
  return slide;
}

async function readManualSlides() {
  const manifest = JSON.parse(await readFile(manualSlidesPath, "utf8"));
  if (!Array.isArray(manifest.slides)) {
    throw new Error("src/data/manual-slides.json must contain a slides array.");
  }
  return manifest.slides;
}

async function build() {
  const [pdfs, manualSlides, previousManifest, previousCache] = await Promise.all([
    findPdfs(slidesDir),
    readManualSlides(),
    readJson(manifestPath, { slides: [] }),
    readJson(cachePath, {}),
  ]);
  const oldManifest = previousManifest && typeof previousManifest === "object"
    ? previousManifest
    : { slides: [] };
  const oldCache = previousCache && typeof previousCache === "object"
    ? previousCache
    : {};
  await mkdir(decksDir, { recursive: true });
  const usedSlugs = new Set();
  const generatedSlides = [];
  const previousSources = oldCache.sources && typeof oldCache.sources === "object"
    ? oldCache.sources
    : {};
  const previousSlidesBySlug = new Map(
    (Array.isArray(oldManifest.slides) ? oldManifest.slides : [])
      .filter((slide) => slide && typeof slide.slug === "string")
      .map((slide) => [slide.slug, slide]),
  );
  const cacheMatchesPipeline =
    oldCache.formatVersion === cacheFormatVersion &&
    oldCache.renderPipelineVersion === renderPipelineVersion;
  const currentSources = {};
  let renderedCount = 0;
  let reusedCount = 0;

  for (const pdf of pdfs) {
    const slug = makeSlug(pdf.relativePath, usedSlugs);
    const sourcePath = pdf.relativePath.split(path.sep).join("/");
    const sourceHash = await sha256File(pdf.absolutePath);
    const previousSource = previousSources[sourcePath];
    const previousSlide = previousSlidesBySlug.get(slug);
    const cachedPageCount = previousSource?.pageCount;
    const cacheCanBeReused =
      cacheMatchesPipeline &&
      previousSource?.sha256 === sourceHash &&
      previousSource?.slug === slug &&
      Number.isInteger(cachedPageCount) &&
      cachedPageCount > 0 &&
      previousSlide?.href === publicPath("slides", pdf.relativePath) &&
      Array.isArray(previousSlide?.pages) &&
      previousSlide.pages.length === cachedPageCount &&
      previousSlide.pages.every((page, index) =>
        page === publicPath("decks", slug, `page-${String(index + 1).padStart(3, "0")}.jpg`),
      ) &&
      await deckPagesExist(slug, cachedPageCount);

    if (cacheCanBeReused) {
      generatedSlides.push(previousSlide);
      currentSources[sourcePath] = previousSource;
      reusedCount += 1;
      continue;
    }

    const slide = await makeSlide({ ...pdf, slug });
    generatedSlides.push(slide);
    currentSources[sourcePath] = {
      sha256: sourceHash,
      slug,
      pageCount: slide.pages.length,
    };
    renderedCount += 1;
  }

  const manualDeckSlugs = new Set(
    manualSlides.map((slide) => slide.slug).filter((slug) => typeof slug === "string"),
  );
  for (const previousSource of Object.values(previousSources)) {
    if (!isGeneratedSlug(previousSource?.slug) || manualDeckSlugs.has(previousSource.slug)) continue;
    const stillUsed = Object.values(currentSources).some(
      (source) => source.slug === previousSource.slug,
    );
    if (!stillUsed) {
      await rm(path.join(decksDir, previousSource.slug), { recursive: true, force: true });
    }
  }

  await mkdir(path.dirname(manifestPath), { recursive: true });
  const output = `${JSON.stringify({ slides: [...generatedSlides, ...manualSlides] }, null, 2)}\n`;
  await writeFile(manifestPath, output);
  const cacheOutput = `${JSON.stringify({
    formatVersion: cacheFormatVersion,
    renderPipelineVersion,
    sources: currentSources,
  }, null, 2)}\n`;
  await writeFile(cachePath, cacheOutput);
  console.log(
    `Rendered ${renderedCount} changed PDF slide(s); reused ${reusedCount} unchanged PDF slide(s).`,
  );
}

build().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
