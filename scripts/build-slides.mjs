import { spawnSync } from "node:child_process";
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(projectRoot, "public");
const slidesDir = path.join(publicDir, "slides");
const previewsDir = path.join(publicDir, "previews");
const manifestPath = path.join(publicDir, "slides.json");

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

  return pdfs;
}

function isLocalPdfSlide(slide) {
  if (typeof slide?.href !== "string") return false;

  try {
    const url = new URL(slide.href, "https://slide-gallery.invalid");
    return (
      url.origin === "https://slide-gallery.invalid" &&
      url.pathname.startsWith("/slides/") &&
      url.pathname.toLowerCase().endsWith(".pdf")
    );
  } catch {
    return false;
  }
}

function publicPath(folder, relativePath) {
  const encodedPath = relativePath
    .split(path.sep)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/${folder}/${encodedPath}`;
}

async function makeSlide({ absolutePath, relativePath }) {
  const info = run("pdfinfo", [absolutePath]);
  const extractedText = run("pdftotext", ["-f", "1", "-l", "5", "-layout", absolutePath, "-"]);
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

  const previewRelativePath = relativePath.replace(/\.pdf$/i, ".png");
  const previewPath = path.join(previewsDir, previewRelativePath);
  const previewPrefix = previewPath.slice(0, -path.extname(previewPath).length);
  await mkdir(path.dirname(previewPath), { recursive: true });

  let shouldRenderPreview = true;
  try {
    const [sourceStat, previewStat] = await Promise.all([
      stat(absolutePath),
      stat(previewPath),
    ]);
    shouldRenderPreview = previewStat.mtimeMs < sourceStat.mtimeMs;
  } catch {
    shouldRenderPreview = true;
  }

  if (shouldRenderPreview) {
    run("pdftoppm", [
      "-f", "1", "-l", "1", "-scale-to", "1200", "-singlefile", "-png",
      absolutePath, previewPrefix,
    ]);
  }

  const slide = {
    title,
    format: "PDF",
    href: publicPath("slides", relativePath),
    preview: publicPath("previews", previewRelativePath),
  };
  const date = dateFromText(extractedText);
  if (date) slide.date = date;
  return slide;
}

async function readExistingSlides() {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!Array.isArray(manifest.slides)) {
      throw new Error("public/slides.json must contain a slides array.");
    }
    return manifest.slides;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function build() {
  const pdfs = await findPdfs(slidesDir);
  const existingSlides = await readExistingSlides();
  const manualSlides = existingSlides.filter((slide) => !isLocalPdfSlide(slide));
  const generatedSlides = [];

  for (const pdf of pdfs) {
    generatedSlides.push(await makeSlide(pdf));
  }

  const output = `${JSON.stringify({ slides: [...generatedSlides, ...manualSlides] }, null, 2)}\n`;
  await writeFile(manifestPath, output);
  console.log(`Generated ${generatedSlides.length} PDF slide(s) in public/slides.json.`);
}

build().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
