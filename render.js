const fs = require("fs");
const path = require("path");
const Handlebars = require("handlebars");

const projectRoot = __dirname;
const dataPath = path.join(projectRoot, "recipe_data.json");
const templatePath = path.join(projectRoot, "template.html");
const outputPath = path.join(projectRoot, "rendered.html");
const assetsPath = path.join(projectRoot, "assets");

if (!fs.existsSync(dataPath)) {
  throw new Error(`Missing file: ${dataPath}`);
}

if (!fs.existsSync(templatePath)) {
  throw new Error(`Missing file: ${templatePath}`);
}

const allowedImageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".svg"]);

const htmlEntityMap = {
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
  "&quot;": "\"",
  "&#39;": "'",
  "&nbsp;": " "
};

function decodeHtmlEntities(value) {
  if (typeof value !== "string") return value;
  return value.replace(
    /&lt;|&gt;|&amp;|&quot;|&#39;|&nbsp;/gi,
    entity => htmlEntityMap[entity.toLowerCase()] || entity
  );
}

function stripHtml(value) {
  if (typeof value !== "string") return value;
  return decodeHtmlEntities(value)
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<span\b[^>]*style\s*=\s*["'][^"']*color\s*:\s*(?:red|yellow|#ff0000|#ffff00)[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\bhttps?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFractions(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/1\s*1\/2/g, "1½")
    .replace(/1\/2/g, "½")
    .replace(/1\/4/g, "¼")
    .replace(/3\/4/g, "¾")
    .replace(/1\/3/g, "⅓")
    .replace(/2\/3/g, "⅔")
    .replace(/1\/8/g, "⅛")
    .replace(/3\/8/g, "⅜")
    .replace(/5\/8/g, "⅝")
    .replace(/7\/8/g, "⅞");
}

function cleanText(value) {
  if (typeof value !== "string") return value;
  return normalizeFractions(stripHtml(value))
    .replace(/\bClassic Chicken Salad\b/gi, "Pound Cake Recipe")
    .replace(/\bChicken Salad\b/gi, "Pound Cake Recipe")
    .trim();
}

function deepClean(value) {
  if (Array.isArray(value)) {
    return value
      .map(item => deepClean(item))
      .filter(item => {
        if (typeof item === "string") return item.trim().length > 0;
        return item !== null && item !== undefined;
      });
  }

  if (value && typeof value === "object") {
    const cleaned = {};
    Object.keys(value).forEach(key => {
      cleaned[key] = deepClean(value[key]);
    });
    return cleaned;
  }

  return cleanText(value);
}

function numericStepNumber(step) {
  const number = Number(step && step.step_number);
  if (!Number.isInteger(number) || number < 1) return null;
  return number;
}

function assetExists(fileName) {
  if (typeof fileName !== "string" || fileName.length === 0) return false;
  if (!fs.existsSync(assetsPath)) return false;
  const absolutePath = path.join(assetsPath, fileName);
  return fs.existsSync(absolutePath);
}

function assetPath(fileName) {
  if (assetExists(fileName)) return `assets/${fileName}`;
  if (!fs.existsSync(assetsPath)) return "";

  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  const candidates = fs
    .readdirSync(assetsPath)
    .filter(name => {
      const candidateExtension = path.extname(name).toLowerCase();
      return (
        path.basename(name, candidateExtension).toLowerCase() === baseName.toLowerCase() &&
        allowedImageExtensions.has(candidateExtension)
      );
    });

  if (candidates.length > 0) return `assets/${candidates[0]}`;
  return "";
}

function boldMeasure(value) {
  if (typeof value !== "string") return value;
  const cleanValue = cleanText(value);
  const formatted = cleanValue.replace(
    /(\b\d+(?:\s+\d+)?(?:[½¼¾⅓⅔⅛⅜⅝⅞])?(?:\s*[-–]\s*\d+(?:[½¼¾⅓⅔⅛⅜⅝⅞])?)?(?:\s*(?:cups?|cup|teaspoons?|teaspoon|tablespoons?|tablespoon|tbsp|tsp|ounces?|ounce|oz|grams?|gram|g|milliliters?|milliliter|millilitres?|millilitre|ml|mL|pounds?|pound|lbs?|lb|inches?|inch|°F|°C))?)/gi,
    "<strong>$1</strong>"
  );
  return new Handlebars.SafeString(formatted);
}

// ⚠️ تعديل مهم: ما كنحيدوش الخطوات اللي ما عندهاش صورة
function flattenSteps(stepPages) {
  if (!Array.isArray(stepPages)) return [];

  const steps = [];

  stepPages.forEach(page => {
    if (!page || !Array.isArray(page.steps)) return;

    page.steps.forEach(step => {
      const stepNumber = numericStepNumber(step);
      if (!step || stepNumber === null) return;

      const title = cleanText(step.title);
      const description = cleanText(step.description);

      if (!title || !description) {
        console.warn(`Skipping empty step ${stepNumber}.`);
        return;
      }

      // كنديرو الصورة إلا كانت كاينة، وإلا كنخليوها فارغة
      const imageFile = `step-${stepNumber}.jpg`;
      const imagePath = assetExists(imageFile) ? `assets/${imageFile}` : "";

      steps.push({
        step_number: stepNumber,
        title,
        description,
        image: imagePath,
        hasImage: Boolean(imagePath),
        alt: `Step ${stepNumber}: ${title}`
      });
    });
  });

  const uniqueSteps = new Map();
  steps
    .sort((a, b) => a.step_number - b.step_number)
    .forEach(step => {
      if (!uniqueSteps.has(step.step_number)) {
        uniqueSteps.set(step.step_number, step);
      }
    });

  return Array.from(uniqueSteps.values());
}

function makePage(type, content) {
  return { type, ...content };
}

Handlebars.registerHelper("boldMeasure", boldMeasure);

Handlebars.registerHelper("asset", function(fileName) {
  return assetPath(fileName);
});

Handlebars.registerHelper("add", function(first, second) {
  return Number(first) + Number(second);
});

Handlebars.registerHelper("eq", function(first, second) {
  return first === second;
});

Handlebars.registerHelper("notEmpty", function(value) {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
});

let data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
data = deepClean(data);

const steps = flattenSteps(data.step_pages);

const basePages = [
  makePage("introduction", {}),
  makePage("ingredients-explained", {}),
  makePage("ingredients", {}),
  makePage("tips", {})
];

const stepPages = steps.map(step => makePage("step", { step }));

const endingPages = [
  makePage("serving", {}),
  makePage("summary", {})
];

const pages = [...basePages, ...stepPages, ...endingPages];
const totalPages = pages.length;

if (totalPages === 0) {
  throw new Error("No pages were generated.");
}

data.pages = pages.map((page, index) => ({
  ...page,
  pageNumber: index + 1,
  totalPages
}));

data.steps = steps;
data.totalPages = totalPages;

data.complete_ingredients = Array.isArray(data.complete_ingredients) ? data.complete_ingredients : [];
data.ingredients_explained = Array.isArray(data.ingredients_explained) ? data.ingredients_explained : [];
data.variations = Array.isArray(data.variations) ? data.variations : [];
data.tips = Array.isArray(data.tips) ? data.tips : [];
data.faq = Array.isArray(data.faq) ? data.faq : [];

if (!data.summary_card || typeof data.summary_card !== "object") {
  data.summary_card = {};
}

data.summary_card.equipment = Array.isArray(data.summary_card.equipment) ? data.summary_card.equipment : [];
data.summary_card.ingredients = data.complete_ingredients;
data.summary_card.instructions = Array.isArray(data.summary_card.instructions)
  ? data.summary_card.instructions.map(instruction => cleanText(instruction)).filter(Boolean)
  : [];
data.summary_card.notes = Array.isArray(data.summary_card.notes) ? data.summary_card.notes : [];
data.summary_card.instructions = data.summary_card.instructions.map(
  instruction => instruction.replace(/^Step\s+\d+\s*:\s*/i, "")
);

const templateSource = fs.readFileSync(templatePath, "utf8");
const template = Handlebars.compile(templateSource, {
  strict: false,
  noEscape: false
});

const html = template(data);

fs.writeFileSync(outputPath, html, "utf8");

console.log(`Rendered successfully: ${outputPath}`);
console.log(`Generated pages: ${totalPages}`);
console.log(`Rendered steps: ${steps.length}`);