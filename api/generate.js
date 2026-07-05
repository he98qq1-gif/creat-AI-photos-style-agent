// api/generate.js
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '15mb',
    },
  },
};

const MODEL = process.env.IMAGE_MODEL || 'gpt-image-2';
const DEFAULT_N = 9;
const CONCURRENCY = 3;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { imageBase64, styles, n } = req.body;
    if (!imageBase64 || !Array.isArray(styles) || styles.length === 0) {
      return res.status(400).json({ error: '缺少 imageBase64 或 styles 参数' });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: '服务端未配置 OPENAI_API_KEY 环境变量' });
    }

    const perStyleCount = Math.min(Math.max(Number(n) || DEFAULT_N, 1), 10);
    const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
    const imageBuffer = Buffer.from(base64Data, 'base64');

    const results = new Array(styles.length);
    let cursor = 0;
    async function worker() {
      while (cursor < styles.length) {
        const idx = cursor++;
        const style = styles[idx];
        try {
          const images = await generateOneStyle(imageBuffer, style.prompt, perStyleCount);
          results[idx] = { name: style.name, images, error: null };
        } catch (err) {
          results[idx] = { name: style.name, images: [], error: err.message || String(err) };
        }
      }
    }
    await Promise.all(new Array(CONCURRENCY).fill(0).map(() => worker()));

    return res.status(200).json({ results });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || '服务器内部错误' });
  }
}

async function generateOneStyle(imageBuffer, prompt, n) {
  const form = new FormData();
  form.append('model', MODEL);
  form.append('prompt', prompt);
  form.append('n', String(n));
  form.append('size', '1024x1024');
  const blob = new Blob([imageBuffer], { type: 'image/png' });
  form.append('image', blob, 'input.png');

  const resp = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: form,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenAI接口错误 ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const data = await resp.json();
  return data.data.map((d) => d.b64_json);
}
