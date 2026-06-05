WidgetMetadata = {
  id: "forward.fanza.missav",
  title: "FANZA_MissAV",
  version: "3.0.0",
  requiredVersion: "0.0.1",
  description: "直接从 FANZA 获取已发行影片，并尝试解析 MissAV 播放链接",
  author: "Sheldon",
  site: "https://video.dmm.co.jp",
  detailCacheDuration: 3600,
  modules: [
    {
      id: "company",
      title: "公司",
      description: "只显示 FANZA 已发行影片，并尝试直接播放",
      requiresWebView: false,
      functionName: "searchCompany",
      sectionMode: false,
      cacheDuration: 1800,
      params: [
        {
          name: "company",
          title: "公司",
          type: "enumeration",
          value: "IPZZ",
          enumOptions: [
            { title: "IdeaPocket / IPZZ", value: "IPZZ" },
            { title: "S1 No.1 Style", value: "S1" },
            { title: "SOD Create", value: "SOD" },
            { title: "MOODYZ / MOD", value: "MOD" }
          ]
        },
        {
          name: "page",
          title: "页码",
          type: "page"
        }
      ]
    }
  ]
};

const FANZA_GRAPHQL_URL = "https://api.video.dmm.co.jp/graphql";
const FANZA_BASE_URL = "https://video.dmm.co.jp";
const FANZA_PAGE_SIZE = 30;
const RETURN_PAGE_SIZE = 20;
const MAX_FANZA_PAGES = 8;

const COMPANY_CONFIG = {
  MOD: {
    labelId: "4325",
    url: "https://video.dmm.co.jp/av/list/?label=4325&sort=release_date"
  },
  S1: {
    labelId: "3474",
    url: "https://video.dmm.co.jp/av/list/?label=3474&sort=release_date"
  },
  IPZZ: {
    labelId: "1561",
    url: "https://video.dmm.co.jp/av/list/?label=1561&sort=release_date"
  },
  SOD: {
    labelId: "24154",
    url: "https://video.dmm.co.jp/av/list/?label=24154&sort=release_date"
  }
};

const FANZA_HEADERS = {
  "Content-Type": "application/json",
  "Accept": "application/json",
  "Origin": FANZA_BASE_URL,
  "Referer": `${FANZA_BASE_URL}/av/list/`,
  "Cookie": "age_check_done=1",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
};

const MISSAV_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  "Referer": "https://missav.ws/",
  "Connection": "keep-alive"
};
const MISSAV_BASE_URLS = ["https://missav.ws", "https://missav.ai"];
const MISSAV_BASE_URL = MISSAV_BASE_URLS[0];
const missavLinkCache = new Map();
const missavVideoCache = new Map();

const SEARCH_QUERY = `
query Search(
  $floor: PPVFloor!,
  $filter: ContentSearchPPVFilterInput,
  $limit: Int!,
  $offset: Int,
  $sort: ContentSearchPPVSort!,
  $facetLimit: Int
) {
  legacySearchPPV(
    floor: $floor,
    filter: $filter,
    limit: $limit,
    offset: $offset,
    sort: $sort,
    facetLimit: $facetLimit
  ) {
    result {
      contents {
        id
        title
        deliveryStartAt
        packageImage {
          largeUrl
          mediumUrl
        }
        sampleImages {
          number
          largeUrl
        }
        maker {
          id
          name
        }
        actresses {
          id
          name
        }
      }
    }
  }
}`;

const DETAIL_QUERY = `
query ContentPageData($id: ID!) {
  ppvContent(id: $id) {
    id
    title
    description
    deliveryStartDate
    makerReleasedAt
    duration
    makerContentId
    packageImage {
      largeUrl
      mediumUrl
    }
    sampleImages {
      number
      imageUrl
      largeImageUrl
    }
    actresses {
      id
      name
    }
    directors {
      id
      name
    }
    maker {
      id
      name
    }
    label {
      id
      name
    }
    genres {
      id
      name
    }
  }
}`;

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeVideoCode(code) {
  return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function formatFanzaCode(value, fallbackId) {
  const candidates = [value, fallbackId].map(cleanText).filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.includes("-")) return candidate.toUpperCase();

    const compact = candidate.toLowerCase().replace(/[^a-z0-9]/g, "");
    const match = compact.match(/^(\d*[a-z]{2,12})0*(\d{2,6})$/);
    if (match) {
      const prefix = match[1].replace(/^\d+/, "").toUpperCase();
      return `${prefix}-${match[2].padStart(3, "0")}`;
    }
  }

  return (candidates[0] || "").toUpperCase();
}

function normalizeDate(value) {
  if (!value) return "";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(text) && text.endsWith("Z")) {
    const timestamp = Date.parse(text);
    if (!Number.isNaN(timestamp)) {
      return new Date(timestamp + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    }
  }
  return text.length >= 10 ? text.slice(0, 10) : text;
}

function todayJst() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isReleasedBeforeToday(item) {
  const releaseDate = normalizeDate(item.deliveryStartDate || item.deliveryStartAt || item.makerReleasedAt);
  return !!releaseDate && releaseDate < todayJst();
}

function asNameList(list) {
  if (!Array.isArray(list)) return [];
  return list.map(item => cleanText(item && item.name ? item.name : item)).filter(Boolean);
}

function detailUrl(id) {
  return `${FANZA_BASE_URL}/av/content/?id=${encodeURIComponent(id)}`;
}

function firstImage(item) {
  const images = item?.sampleImages || [];
  const first = Array.isArray(images) && images.length ? images[0] : null;
  return first?.largeImageUrl || first?.largeUrl || first?.imageUrl || "";
}

function missavRequestHeaders(url) {
  try {
    const origin = new URL(url).origin;
    return {
      ...MISSAV_HEADERS,
      "Referer": `${origin}/`,
      "Origin": origin
    };
  } catch (_) {
    return MISSAV_HEADERS;
  }
}

function buildPlaybackHeaders(link) {
  return missavRequestHeaders(link || MISSAV_BASE_URL);
}

function toAbsoluteMissavUrl(href, baseUrl = MISSAV_BASE_URL) {
  if (!href) return "";
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("/")) return `${baseUrl}${href}`;
  return `${baseUrl}/${href}`;
}

function normalizeMissavSlugFromLink(link) {
  if (!link) return "";
  try {
    const path = new URL(link).pathname;
    const slug = (path.split("/").pop() || "").replace(/-uncensored-leak|-chinese-subtitle/g, "");
    return normalizeVideoCode(slug);
  } catch (_) {
    return "";
  }
}

function parseMissavDetailLinkByCode(html, number, baseUrl = MISSAV_BASE_URL) {
  if (!html || typeof html !== "string" || html.includes("Just a moment")) return "";

  const targetCode = normalizeVideoCode(number);
  const $ = Widget.html.load(html);
  const links = [];

  $("a.text-secondary").each((i, el) => {
    const full = toAbsoluteMissavUrl($(el).attr("href"), baseUrl);
    if (full) links.push(full);
  });

  const exact = links.find(link => normalizeMissavSlugFromLink(link) === targetCode);
  return exact || links[0] || "";
}

function missavDetailUrl(baseUrl, number) {
  return `${baseUrl}/cn/${encodeURIComponent(String(number || "").toLowerCase())}`;
}

async function resolveMissavDetailLinkByCode(number) {
  const key = normalizeVideoCode(number);
  if (!key) return "";
  if (missavLinkCache.has(key)) return missavLinkCache.get(key);

  let link = "";
  for (const baseUrl of MISSAV_BASE_URLS) {
    const directLink = missavDetailUrl(baseUrl, number);
    try {
      const directRes = await Widget.http.get(directLink, { headers: missavRequestHeaders(directLink), timeout: 10000 });
      const html = directRes?.data || "";
      if (html && !html.includes("Just a moment") && normalizeVideoCode(html).includes(key)) {
        link = directLink;
      }
    } catch (_) {
      link = "";
    }

    if (!link) {
      try {
        const searchUrl = `${baseUrl}/cn/search/${encodeURIComponent(number)}`;
        const res = await Widget.http.get(searchUrl, { headers: missavRequestHeaders(searchUrl), timeout: 10000 });
        link = parseMissavDetailLinkByCode(res?.data || "", number, baseUrl);
      } catch (_) {
        link = "";
      }
    }

    if (link) break;
  }

  missavLinkCache.set(key, link || "");
  return link || "";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unpackPacker(source) {
  const match = String(source || "").match(/eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/);
  if (!match) return "";

  let payload = match[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  const radix = Number(match[2]);
  const count = Number(match[3]);
  const words = match[4].split("|");

  for (let index = count - 1; index >= 0; index--) {
    const word = words[index];
    if (!word) continue;

    const encoded = index.toString(radix);
    payload = payload.replace(new RegExp(`\\b${escapeRegExp(encoded)}\\b`, "g"), word);
  }

  return payload;
}

function pickBestM3u8(urls) {
  if (!Array.isArray(urls) || !urls.length) return "";
  return urls.find(url => /1080p/i.test(url))
    || urls.find(url => /720p/i.test(url))
    || urls[0];
}

function findM3u8Url(text) {
  const matches = String(text || "").match(/https:\/\/surrit\.com\/[a-f0-9\-]+\/[^"'\s\\]*\.m3u8/g);
  return pickBestM3u8(matches || []);
}

async function extractMissavVideoUrl(link) {
  if (!link) return "";
  if (missavVideoCache.has(link)) return missavVideoCache.get(link);

  try {
    const res = await Widget.http.get(link, { headers: missavRequestHeaders(link), timeout: 10000 });
    const html = res?.data || "";
    if (!html || typeof html !== "string" || html.includes("Just a moment")) {
      missavVideoCache.set(link, "");
      return "";
    }

    let videoUrl = findM3u8Url(html);
    const $ = Widget.html.load(html);
    $("script").each((i, el) => {
      const scriptContent = $(el).html() || "";

      const directUrl = findM3u8Url(scriptContent);
      if (directUrl) {
        videoUrl = directUrl;
        return false;
      }

      const unpackedUrl = findM3u8Url(unpackPacker(scriptContent));
      if (unpackedUrl) {
        videoUrl = unpackedUrl;
        return false;
      }

      if (!videoUrl && scriptContent.includes("eval(function")) {
        const uuidMatches = scriptContent.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g);
        if (uuidMatches && uuidMatches.length > 0) {
          videoUrl = `https://surrit.com/${uuidMatches[0]}/playlist.m3u8`;
          return false;
        }
      }
    });

    if (!videoUrl) {
      const matchSimple = html.match(/source\s*=\s*['"]([^'"]+)['"]/);
      if (matchSimple) videoUrl = matchSimple[1];
    }

    missavVideoCache.set(link, videoUrl || "");
    return videoUrl || "";
  } catch (_) {
    missavVideoCache.set(link, "");
    return "";
  }
}

async function fanzaGraphql(query, variables, referer) {
  const response = await Widget.http.post(
    FANZA_GRAPHQL_URL,
    JSON.stringify({ query, variables }),
    {
      headers: { ...FANZA_HEADERS, Referer: referer || FANZA_HEADERS.Referer },
      timeout: 15000
    }
  );

  const data = response?.data;
  if (!data) throw new Error("FANZA 返回为空");
  if (Array.isArray(data.errors) && data.errors.length) {
    throw new Error(data.errors.map(error => error.message).join("; "));
  }
  return data.data || {};
}

async function fetchSearchPage(config, page) {
  const variables = {
    floor: "AV",
    filter: { labelIds: { ids: [{ id: config.labelId }], op: "AND" } },
    limit: FANZA_PAGE_SIZE,
    offset: (Math.max(1, page) - 1) * FANZA_PAGE_SIZE,
    sort: "DELIVERY_START_DATE",
    facetLimit: 10
  };
  const data = await fanzaGraphql(SEARCH_QUERY, variables, config.url);
  return data?.legacySearchPPV?.result?.contents || [];
}

async function fetchDetail(id) {
  if (!id) return null;
  const data = await fanzaGraphql(DETAIL_QUERY, { id }, detailUrl(id));
  return data?.ppvContent || null;
}

async function fetchReleasedCandidates(config, requiredCount) {
  const released = [];
  const seen = new Set();

  for (let page = 1; page <= MAX_FANZA_PAGES && released.length < requiredCount; page++) {
    const items = await fetchSearchPage(config, page);
    if (!items.length) break;

    for (const item of items) {
      if (!item?.id || seen.has(item.id) || !isReleasedBeforeToday(item)) continue;
      seen.add(item.id);
      released.push(item);
      if (released.length >= requiredCount) break;
    }
  }

  return released;
}

async function toPlayableMovieItem(item) {
  const detail = await fetchDetail(item.id).catch(() => null);
  const full = { ...item, ...(detail || {}) };
  const code = formatFanzaCode(full.makerContentId, full.id);
  const missavLink = await resolveMissavDetailLinkByCode(code);
  const videoUrl = await extractMissavVideoUrl(missavLink);

  if (!videoUrl) return null;

  const actresses = asNameList(full.actresses);
  const directors = asNameList(full.directors);
  const genres = asNameList(full.genres);
  const maker = cleanText(full?.maker?.name);
  const label = cleanText(full?.label?.name);
  const posterPath = full?.packageImage?.mediumUrl || full?.packageImage?.largeUrl || "";
  const backdropPath = full?.packageImage?.largeUrl || firstImage(full) || posterPath;
  const releaseDate = normalizeDate(full.deliveryStartDate || full.deliveryStartAt || full.makerReleasedAt);
  const durationSeconds = Number(full.duration || 0);
  const durationMinutes = durationSeconds ? Math.round(durationSeconds / 60) : 0;

  return {
    id: full.id || normalizeVideoCode(code),
    type: "video",
    title: `${code} ${cleanText(full.title)}`.trim(),
    description: [
      actresses.length ? `演员：${actresses.join(" / ")}` : "",
      directors.length ? `导演：${directors.join(" / ")}` : "",
      maker ? `厂商：${maker}` : "",
      label ? `厂牌：${label}` : "",
      genres.length ? `类型：${genres.join(" / ")}` : "",
      cleanText(full.description)
    ].filter(Boolean).join("\n"),
    posterPath,
    backdropPath,
    releaseDate,
    mediaType: "movie",
    rating: 0,
    duration: durationMinutes,
    durationText: durationMinutes ? `${durationMinutes}分钟` : "",
    genreTitle: actresses.join(", "),
    link: missavLink,
    videoUrl,
    previewUrl: videoUrl,
    playerType: "system",
    customHeaders: buildPlaybackHeaders(missavLink)
  };
}

async function searchCompany(params = {}) {
  const companyKey = String(params.company || "IPZZ").toUpperCase();
  const config = COMPANY_CONFIG[companyKey] || COMPANY_CONFIG.IPZZ;
  const page = Math.max(1, Number(params.page || 1));
  const requiredCount = page * RETURN_PAGE_SIZE;
  const candidates = await fetchReleasedCandidates(config, requiredCount);
  const pageCandidates = candidates.slice((page - 1) * RETURN_PAGE_SIZE, page * RETURN_PAGE_SIZE);
  const playable = await Promise.all(pageCandidates.map(toPlayableMovieItem));
  return playable.filter(Boolean);
}
