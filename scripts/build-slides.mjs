import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(projectRoot, "public");
const slidesDir = path.join(publicDir, "slides");
const decksDir = path.join(publicDir, "decks");
const manualSlidesPath = path.join(projectRoot, "src", "data", "manual-slides.json");
const manifestPath = path.join(projectRoot, "src", "data", "slides.json");

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

function publicPath(...segments) {
  return `/${segments
    .flatMap((segment) => segment.split(path.sep))
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

async function makeSlide({ absolutePath, relativePath, usedSlugs }) {
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

  const slug = makeSlug(relativePath, usedSlugs);
  const deckDir = path.join(decksDir, slug);
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
  const [pdfs, manualSlides] = await Promise.all([
    findPdfs(slidesDir),
    readManualSlides(),
  ]);
  await rm(decksDir, { recursive: true, force: true });
  await mkdir(decksDir, { recursive: true });
  const usedSlugs = new Set();
  const generatedSlides = [];

  for (const pdf of pdfs) {
    generatedSlides.push(await makeSlide({ ...pdf, usedSlugs }));
  }

  await mkdir(path.dirname(manifestPath), { recursive: true });
  const output = `${JSON.stringify({ slides: [...generatedSlides, ...manualSlides] }, null, 2)}\n`;
  await writeFile(manifestPath, output);
  console.log(`Generated ${generatedSlides.length} PDF slide(s) in src/data/slides.json.`);
}

build().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
