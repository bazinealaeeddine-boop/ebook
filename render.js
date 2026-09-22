const fs = require("fs");
const path = require("path");
const Handlebars = require("handlebars");

const projectRoot = __dirname;
const dataPath = path.join(projectRoot, "recipe_data.json");
const templatePath = path.join(projectRoot, "template.html");
const outputPath = path.join(projectRoot, "rendered.html");

if (!fs.existsSync(dataPath)) throw new Error(`Missing file: ${dataPath}`);
if (!fs.existsSync(templatePath)) throw new Error(`Missing file: ${templatePath}`);

const assetDirectories = [path.join(projectRoot, "assets"), projectRoot];
const allowedImageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".svg"]);
const entityMap = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": "\"", "&#39;": "'", "&nbsp;": " " };

function decodeHtmlEntities(value) {
  if (typeof value !== "string") return value;
  return value.replace(/&lt;|&gt;|&amp;|&quot;|&#39;|&nbsp;/gi, entity => entityMap[entity.toLowerCase()] || entity);
}

function stripHtml(value) {
  if (typeof value !== "string") return value;
  return decodeHtmlEntities(value)
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\bhttps?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFractions(value) {
  if (typeof value !== "string") return value;
  return value.replace(/1\s*1\/2/g, "1½").replace(/1\/2/g, "½").replace(/1\/4/g, "¼").replace(/3\/4/g, "¾").replace(/1\/3/g, "⅓").replace(/2\/3/g, "⅔").replace(/1\/8/g, "⅛").replace(/3\/8/g, "⅜").replace(/5\/8/g, "⅝").replace(/7\/8/g, "⅞");
}

function cleanText(value) {
  return typeof value === "string" ? normalizeFractions(stripHtml(value)).trim() : value;
}

function deepClean(value) {
  if (Array.isArray(value)) return value.map(deepClean).filter(item => item !== null && item !== undefined && (typeof item !== "string" || item.trim()));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepClean(item)]));
  return cleanText(value);
}

function findAsset(fileName) {
  if (typeof fileName !== "string" || !fileName) return null;
  for (const directory of assetDirectories) {
    const direct = path.join(directory, fileName);
    if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
  }
  const extension = path.extname(fileName);
  const base = path.basename(fileName, extension).toLowerCase();
  for (const directory of assetDirectories) {
    if (!fs.existsSync(directory)) continue;
    const match = fs.readdirSync(directory).find(name => {
      const ext = path.extname(name).toLowerCase();
      return path.basename(name, ext).toLowerCase() === base && allowedImageExtensions.has(ext);
    });
    if (match) return path.join(directory, match);
  }
  return null;
}

function assetPath(fileName) {
  const absolute = findAsset(fileName);
  if (!absolute) return "";
  return `./${path.relative(projectRoot, absolute).split(path.sep).join("/")}`;
}

function boldMeasure(value) {
  if (typeof value !== "string") return value;
  const text = cleanText(value);
  const formatted = text.replace(/(\b\d+(?:\s+\d+)?(?:[½¼¾⅓⅔⅛⅜⅝⅞])?(?:\s*(?:cups?|cup|teaspoons?|teaspoon|tablespoons?|tablespoon|tbsp|tsp|ounces?|ounce|oz|grams?|gram|g|kilograms?|kilogram|kg|ml|milliliters?|milliliter|liters?|liter|l))?)/gi, "<strong>$1</strong>");
  return new Handlebars.SafeString(formatted);
}

function flattenSteps(stepPages) {
  if (!Array.isArray(stepPages)) return [];
  const steps = [];
  stepPages.forEach(page => {
    if (!page || !Array.isArray(page.steps)) return;
    page.steps.forEach(step => {
      const number = Number(step && step.step_number);
      const title = cleanText(step && step.title);
      const description = cleanText(step && step.description);
      if (!Number.isInteger(number) || number < 1 || !title || !description) return;
      const image = assetPath(`step-${number}.jpg`);
      steps.push({ step_number: number, title, description, image, hasImage: Boolean(image), alt: `Step ${number}: ${title}` });
    });
  });
  return Array.from(new Map(steps.sort((a, b) => a.step_number - b.step_number).map(step => [step.step_number, step])).values());
}

Handlebars.registerHelper("boldMeasure", boldMeasure);
Handlebars.registerHelper("asset", assetPath);
Handlebars.registerHelper("add", (a, b) => Number(a) + Number(b));
Handlebars.registerHelper("eq", (a, b) => a === b);
Handlebars.registerHelper("notEmpty", value => Array.isArray(value) ? value.length > 0 : Boolean(value));

let data = deepClean(JSON.parse(fs.readFileSync(dataPath, "utf8")));
const steps = flattenSteps(data.step_pages);
const pages = [
  { type: "introduction" },
  { type: "ingredients-explained" },
  { type: "ingredients" },
  { type: "tips" },
  ...steps.map(step => ({ type: "step", step })),
  { type: "serving" },
  { type: "summary" }
];

if (!pages.length) throw new Error("No pages were generated.");
const totalPages = pages.length;
data.pages = pages.map((page, index) => ({ ...page, pageNumber: index + 1, totalPages }));
data.steps = steps;
data.totalPages = totalPages;
data.complete_ingredients = Array.isArray(data.complete_ingredients) ? data.complete_ingredients : [];
data.ingredients_explained = Array.isArray(data.ingredients_explained) ? data.ingredients_explained : [];
data.variations = Array.isArray(data.variations) ? data.variations : [];
data.tips = Array.isArray(data.tips) ? data.tips : [];
data.faq = Array.isArray(data.faq) ? data.faq : [];
data.summary_card = data.summary_card && typeof data.summary_card === "object" ? data.summary_card : {};
data.summary_card.equipment = Array.isArray(data.summary_card.equipment) ? data.summary_card.equipment : [];
data.summary_card.ingredients = data.complete_ingredients;
data.summary_card.instructions = Array.isArray(data.summary_card.instructions) ? data.summary_card.instructions.map(cleanText).filter(Boolean).map(text => text.replace(/^Step\s+\d+\s*:\s*/i, "")) : [];
data.summary_card.notes = Array.isArray(data.summary_card.notes) ? data.summary_card.notes : [];

const template = Handlebars.compile(fs.readFileSync(templatePath, "utf8"), { strict: false, noEscape: false });
let html = template(data);
const premiumLink = '<link rel="stylesheet" href="premium.css">';
if (!html.includes(premiumLink)) html = html.replace("</head>", `  ${premiumLink}\n</head>`);

const qualityStrip = `<div class="cover-quality-strip" aria-label="Recipe highlights"><span>Tested recipe</span><span>Step-by-step guide</span><span>Printable edition</span></div>`;
const coverEnd = html.indexOf("</section>");
if (coverEnd !== -1 && !html.includes("cover-quality-strip")) html = `${html.slice(0, coverEnd)}${qualityStrip}\n${html.slice(coverEnd)}`;

fs.writeFileSync(outputPath, html, "utf8");
console.log(`Rendered successfully: ${outputPath}`);
console.log(`Generated pages: ${totalPages}`);
console.log(`Rendered steps: ${steps.length}`);
