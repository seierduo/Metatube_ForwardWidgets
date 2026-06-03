WidgetMetadata = {
  id: "forward.fanza",
  title: "FANZA",
  version: "3.0.0",
  requiredVersion: "0.0.1",
  description: "直接从 FANZA 获取厂商影片数据",
  author: "Sheldon",
  site: "https://video.dmm.co.jp",
  detailCacheDuration: 3600,
  modules: [
    {
      id: "company",
      title: "公司",
      description: "按 FANZA 页面顺序查看厂商影片",
      requiresWebView: false,
      functionName: "searchCompany",
      sectionMode: false,
      cacheDuration: 3600,
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
    },
    {
      id: "actress",
      title: "演员",
      description: "用演员名在 FANZA 搜索影片",
      requiresWebView: false,
      functionName: "searchActress",
      sectionMode: false,
      cacheDuration: 3600,
      params: [
        {
          name: "actress",
          title: "演员名",
          type: "input",
          placeholders: [
            { title: "示例", value: "西宮ゆめ" }
          ]
        },
        {
          name: "page",
          title: "页码",
          type: "page"
        }
      ]
    },
    {
      id: "code",
      title: "番号",
      description: "输入番号从 FANZA 搜索影片",
      requiresWebView: false,
      functionName: "searchCode",
      sectionMode: false,
      cacheDuration: 3600,
      params: [
        {
          name: "code",
          title: "番号",
          type: "input",
          placeholders: [
            { title: "示例", value: "IPZZ-888" }
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
const FANZA_PAGE_SIZE = 20;

const COMPANY_CONFIG = {
  MOD: {
    title: "MOODYZ / MOD",
    labelId: "4325",
    url: "https://video.dmm.co.jp/av/list/?label=4325&sort=release_date"
  },
  S1: {
    title: "S1 No.1 Style",
    labelId: "3474",
    url: "https://video.dmm.co.jp/av/list/?label=3474&sort=release_date"
  },
  IPZZ: {
    title: "IdeaPocket / IPZZ",
    labelId: "1561",
    url: "https://video.dmm.co.jp/av/list/?label=1561&sort=release_date"
  },
  SOD: {
    title: "SOD Create",
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

const SEARCH_QUERY = `
query Search(
  $floor: PPVFloor!,
  $filter: ContentSearchPPVFilterInput,
  $limit: Int!,
  $offset: Int,
  $sort: ContentSearchPPVSort!,
  $queryWord: String,
  $facetLimit: Int
) {
  legacySearchPPV(
    floor: $floor,
    filter: $filter,
    limit: $limit,
    offset: $offset,
    sort: $sort,
    queryWord: $queryWord,
    facetLimit: $facetLimit
  ) {
    result {
      pageInfo {
        totalCount
        limit
        offset
      }
      contents {
        id
        title
        contentType
        deliveryStartAt
        packageImage {
          largeUrl
          mediumUrl
        }
        sampleImages {
          number
          largeUrl
        }
        sampleMovie {
          hlsUrl
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
    sample2DMovie {
      highestMovieUrl
      hlsMovieUrl
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

function normalizeCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function codeToContentId(value) {
  const text = String(value || "").trim().toLowerCase();
  const match = text.match(/^([a-z]{2,10})[-_ ]?0*(\d{2,6})$/i);
  if (!match) return "";

  const prefix = match[1].toLowerCase();
  const number = match[2].padStart(5, "0");
  return `${prefix === "start" ? "1start" : prefix}${number}`;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function formatFanzaCode(value, fallbackId) {
  const raw = cleanText(value);
  if (raw) return raw.toUpperCase();

  const id = String(fallbackId || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const match = id.match(/^(\d*[a-z]{2,10})0*(\d{2,6})$/);
  if (!match) return String(fallbackId || "").toUpperCase();
  const prefix = match[1].replace(/^\d+/, "").toUpperCase();
  return `${prefix}-${match[2].padStart(3, "0")}`;
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

function previewUrl(item) {
  return item?.sample2DMovie?.hlsMovieUrl ||
    item?.sample2DMovie?.highestMovieUrl ||
    item?.sampleMovie?.hlsUrl ||
    "";
}

function toMovieItem(item) {
  const code = formatFanzaCode(item.makerContentId, item.id);
  const actresses = asNameList(item.actresses);
  const directors = asNameList(item.directors);
  const genres = asNameList(item.genres);
  const maker = cleanText(item?.maker?.name);
  const label = cleanText(item?.label?.name);
  const posterPath = item?.packageImage?.mediumUrl || item?.packageImage?.largeUrl || "";
  const backdropPath = item?.packageImage?.largeUrl || firstImage(item) || posterPath;
  const trailerUrl = previewUrl(item);
  const releaseDate = normalizeDate(item.deliveryStartDate || item.deliveryStartAt || item.makerReleasedAt);
  const durationSeconds = Number(item.duration || 0);
  const durationMinutes = durationSeconds ? Math.round(durationSeconds / 60) : 0;

  return {
    id: item.id || normalizeCode(code),
    type: trailerUrl ? "video" : "url",
    title: `${code} ${cleanText(item.title)}`.trim(),
    description: [
      actresses.length ? `演员：${actresses.join(" / ")}` : "",
      directors.length ? `导演：${directors.join(" / ")}` : "",
      maker ? `厂商：${maker}` : "",
      label ? `厂牌：${label}` : "",
      genres.length ? `类型：${genres.join(" / ")}` : "",
      cleanText(item.description)
    ].filter(Boolean).join("\n"),
    posterPath,
    backdropPath,
    releaseDate,
    mediaType: "movie",
    rating: 0,
    duration: durationMinutes,
    durationText: durationMinutes ? `${durationMinutes}分钟` : "",
    genreTitle: actresses.join(", "),
    link: detailUrl(item.id),
    videoUrl: trailerUrl,
    previewUrl: trailerUrl,
    playerType: "system",
    customHeaders: trailerUrl ? {
      "Referer": FANZA_BASE_URL,
      "Origin": FANZA_BASE_URL,
      "User-Agent": FANZA_HEADERS["User-Agent"]
    } : undefined
  };
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

async function fetchSearchPage(options = {}) {
  const page = Math.max(1, Number(options.page || 1));
  const variables = {
    floor: "AV",
    filter: options.filter,
    limit: FANZA_PAGE_SIZE,
    offset: (page - 1) * FANZA_PAGE_SIZE,
    sort: "DELIVERY_START_DATE",
    queryWord: options.queryWord || undefined,
    facetLimit: 10
  };
  const data = await fanzaGraphql(SEARCH_QUERY, variables, options.referer);
  return data?.legacySearchPPV?.result?.contents || [];
}

async function fetchDetail(id) {
  if (!id) return null;
  const data = await fanzaGraphql(DETAIL_QUERY, { id }, detailUrl(id));
  return data?.ppvContent || null;
}

async function enrichItems(items) {
  const detailed = await Promise.all(
    items.map(async item => {
      const detail = await fetchDetail(item.id).catch(() => null);
      return { ...item, ...(detail || {}) };
    })
  );
  return detailed.map(toMovieItem);
}

async function searchCompany(params = {}) {
  const companyKey = String(params.company || "IPZZ").toUpperCase();
  const config = COMPANY_CONFIG[companyKey] || COMPANY_CONFIG.IPZZ;
  const items = await fetchSearchPage({
    page: params.page || 1,
    filter: { labelIds: { ids: [{ id: config.labelId }], op: "AND" } },
    referer: config.url
  });
  return enrichItems(items);
}

async function searchActress(params = {}) {
  const actress = cleanText(params.actress);
  if (!actress) throw new Error("请输入演员名");

  const items = await fetchSearchPage({
    page: params.page || 1,
    queryWord: actress,
    referer: `${FANZA_BASE_URL}/av/list/?keyword=${encodeURIComponent(actress)}`
  });
  return enrichItems(items);
}

async function searchCode(params = {}) {
  const code = cleanText(params.code);
  if (!code) throw new Error("请输入番号");

  const contentId = codeToContentId(code);
  if (contentId) {
    const detail = await fetchDetail(contentId).catch(() => null);
    if (detail && detail.id) return [toMovieItem(detail)];
  }

  const items = await fetchSearchPage({
    page: params.page || 1,
    queryWord: normalizeCode(code),
    referer: `${FANZA_BASE_URL}/av/list/?keyword=${encodeURIComponent(code)}`
  });
  const target = normalizeCode(code);
  const ranked = [...items].sort((a, b) => {
    const aCode = normalizeCode(formatFanzaCode(a.makerContentId, a.id));
    const bCode = normalizeCode(formatFanzaCode(b.makerContentId, b.id));
    const aExact = aCode === target ? 0 : 1;
    const bExact = bCode === target ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    const aContains = aCode.includes(target) ? 0 : 1;
    const bContains = bCode.includes(target) ? 0 : 1;
    return aContains - bContains;
  });
  return enrichItems(ranked);
}
