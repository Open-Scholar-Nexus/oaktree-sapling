// inspired by FreekPols and luukfroling's gallery https://github.com/TUD-JB-Templates/JB2_plugins
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import yaml from 'js-yaml';

// used for debugging locally
const LOCAL_PATH = process.env.NEXUS_LOCAL_PATH;

function readLocalYaml(filePath) {
  try {
    return yaml.load(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`Error reading ${filePath}:`, e.message);
    return null;
  }
}

function parsePapers() {
  const lines = fs.readFileSync('papers.txt', 'utf8').split('\n');
  const papers = [];
  let currentYear = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) {
      currentYear = trimmed.slice(1).trim();
    } else {
      papers.push({ name: trimmed, year: currentYear });
    }
  }
  return papers;
}

function getPaperConfig(name) {
  if (LOCAL_PATH) {
    const paperDir = path.join(LOCAL_PATH, name);
    return readLocalYaml(path.join(paperDir, 'myst.yml'));
  } else {
    try {
      const url = `https://raw.githubusercontent.com/pollomarzo/${name}/main/myst.yml`;
      const result = execSync(`curl -s "${url}"`, { encoding: 'utf8' });
      return yaml.load(result);
    } catch (e) {
      console.error(`Error fetching config for ${name}:`, e.message);
      return null;
    }
  }
}

function buildCard(name, config) {
  const title = config.project.title || name;
  const keywords = config.project.keywords || [];
  const thumbnail = config.project.thumbnail;
  const bookUrl = `https://pollomarzo.github.io/${name}`;
  const imageUrl = thumbnail
    ? `https://raw.githubusercontent.com/pollomarzo/${name}/main/${thumbnail}`
    : null;

  const children = [
    { type: 'header', children: [{ type: 'text', value: title }] },
  ];

  if (imageUrl) {
    children.push({
      type: 'image',
      url: imageUrl,
      alt: title,
      width: '100%',
    });
  }

  if (keywords.length > 0) {
    children.push({
      type: 'paragraph',
      children: [{ type: 'text', value: keywords.join(' | ') }],
    });
  }

  return {
    type: 'card',
    url: bookUrl,
    children,
  };
}

const paperCardsDirective = {
  name: 'paper-cards',
  doc: 'Generate a gallery of paper cards',
  options: {
    subset: { type: String, doc: 'Filter by year' },
  },
  run(data) {
    const subset = data.options?.subset;
    const allPapers = parsePapers();
    const papers = allPapers.filter(p => !subset || p.year === subset);
    console.warn(`paper-cards: subset=${subset}, found ${papers.length} papers`);

    const cards = papers.map(({ name }) => {
      const config = getPaperConfig(name);
      if (!config?.project) return null;
      return buildCard(name, config);
    });

    const validCards = cards.filter(Boolean);

    if (validCards.length === 0) {
      return [{ type: 'paragraph', children: [{ type: 'text', value: 'No papers found.' }] }];
    }

    return [
      {
        type: 'grid',
        columns: [1, 1, 2, 3],
        children: validCards,
      },
    ];
  },
};

const plugin = {
  name: 'Paper Gallery',
  directives: [paperCardsDirective],
};

export default plugin;
