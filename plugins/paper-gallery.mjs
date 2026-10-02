// inspired by FreekPols and luukfroling's gallery https://github.com/TUD-JB-Templates/JB2_plugins
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const PAPERS_DIR = 'papers';

function parsePapers() {
  const lines = readFileSync('papers.txt', 'utf8').split('\n');
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

function fetchPaperConfig(name) {
  const configPath = path.join(PAPERS_DIR, name, 'myst.yml');
  if (!existsSync(configPath)) {
    console.warn(`paper-gallery: skipping "${name}" (no ${configPath})`);
    return null;
  }
  const content = readFileSync(configPath, 'utf8');
  return yaml.load(content);
}

function getPaperUrl(name) {
  // BASE_URL is set by build.bash (e.g. /oaktree-sapling for GH Pages)
  const base = process.env.BASE_URL || '';
  return `${base}/${PAPERS_DIR}/${name}`;
}

function getThumbnailUrl(name) {
  // In the monorepo, thumbnails are served from each paper's built site
  const base = process.env.BASE_URL || '';
  return `${base}/${PAPERS_DIR}/${name}/thumbnails/thumbnail.png`;
}

const paperCardsDirective = {
  name: 'paper-cards',
  doc: 'Generate a gallery of paper cards',
  options: {
    subset: { type: String, doc: 'Filter by year' },
  },
  run(data) {
    const subset = data.options?.subset;
    const papers = parsePapers().filter(p => !subset || p.year === subset);
    console.log(`paper-cards: subset=${subset}, found ${papers.length} papers`);

    if (papers.length === 0) {
      return [{ type: 'paragraph', children: [{ type: 'text', value: 'No papers found.' }] }];
    }

    return [
      {
        type: 'grid',
        columns: [1, 1, 2, 3],
        children: papers.map(({ name }) => ({ type: 'paper-card-ref', name, children: [] })),
      },
    ];
  },
};

function paperCardsTransform(opts, utils) {
  return async (mdast) => {
    const nodes = utils.selectAll('paper-card-ref', mdast);
    if (nodes.length === 0) return;

    await Promise.all(
      nodes.map(async (node) => {
        const config = fetchPaperConfig(node.name);
        if (!config) {
          node.type = 'paragraph';
          node.children = [{ type: 'text', value: `Paper "${node.name}" not found locally.` }];
          return;
        }
        console.log(`Building card for "${node.name}"`);

        const title = config.project.title || node.name;
        const keywords = config.project.keywords || [];

        // Mutate node into a card
        node.type = 'card';
        node.url = getPaperUrl(node.name);
        node.children = [
          { type: 'header', children: [{ type: 'text', value: title }] },
          {
            type: 'image',
            url: getThumbnailUrl(node.name),
            alt: title,
            width: '100%',
          },
        ];

        if (keywords.length > 0) {
          node.children.push({
            type: 'paragraph',
            children: [{ type: 'text', value: keywords.join(' | ') }],
          });
        }
      })
    );
  };
}

const plugin = {
  name: 'Paper Gallery',
  directives: [paperCardsDirective],
  transforms: [{ plugin: paperCardsTransform, stage: 'document' }],
};

export default plugin;
