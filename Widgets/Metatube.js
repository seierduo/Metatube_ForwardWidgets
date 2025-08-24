WidgetMetadata = {
  id: "forward.metatube",
  title: "MetaTube",
  version: "1.0.0",
  requiredVersion: "0.0.1",
  description: "获取各大AV公司的影片数据 - 需手动配置服务器地址",
  author: "seierduo",
  detailCacheDuration: 3600,
  modules: [
    {
      id: "company",
      title: "公司",
      description: "选择不同AV公司查看其系列影片",
      requiresWebView: false,
      functionName: "searchCompany",
      sectionMode: false,
      cacheDuration: 3600,
      params: [
        {
          name: "serverUrl",
          title: "服务器地址",
          type: "input",
          value: "http://your-server:8080",
          placeholder: "请输入MetaTube服务器地址，如: http://your-server:8080"
        },
        {
          name: "company",
          title: "公司",
          type: "enumeration",
          value: "IPZZ",
          enumOptions: [
            {
              title: "IdeaPocket",
              value: "IPZZ"
            },
            {
              title: "S1 No.1 Style",
              value: "SONE"
            },
            {
              title: "SOD Create",
              value: "START"
            },
            {
              title: "Prestige",
              value: "ABF"
            },
            {
              title: "FALENO",
              value: "FNS"
            }
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

function transformMovieData(movie) {
  return {
    id: movie.number || movie.id,
    type: "url",
    title: `${movie.number} ${movie.title}`,
    description: movie.summary || "",
    posterPath: movie.thumb_url || movie.cover_url,
    backdropPath: movie.cover_url || movie.thumb_url,
    releaseDate: movie.release_date,
    mediaType: "movie",
    rating: movie.score || 0,
    duration: movie.runtime || 0,
    durationText: movie.runtime ? `${movie.runtime}分钟` : "",
    genreTitle: Array.isArray(movie.actors) ? movie.actors.join(", ") : "",
    link: movie.homepage,
    videoUrl: "",
    previewUrl: "",
    playerType: "system"
  };
}

async function searchCompany(params = {}) {
  try {
    const serverUrl = params.serverUrl;
    const company = params.company || "IPZZ";
    const page = params.page || 1;
    const pageSize = 20;
    
    if (!serverUrl || serverUrl.trim() === "") {
      throw new Error("请先配置MetaTube服务器地址");
    }
    
    // 确保服务器地址格式正确
    const baseUrl = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
    
    console.log(`使用服务器: ${baseUrl}`);
    console.log(`搜索 ${company} 系列，第${page}页`);
    
    const response = await Widget.http.get(
      `${baseUrl}/v1/movies/search?q=${company}&fallback=true`,
      {
        headers: {
          "User-Agent": "ForwardWidget/1.0.0",
          "Accept": "application/json"
        },
        timeout: 10000
      }
    );

    if (!response || !response.data || !response.data.data) {
      throw new Error(`获取${company}数据失败`);
    }

    const allMovies = response.data.data;
    console.log(`获取到 ${allMovies.length} 部 ${company} 系列影片`);
    
    // 分页处理
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const pageMovies = allMovies.slice(start, end);
    
    // 转换数据格式
    const movies = pageMovies.map(transformMovieData);
    
    console.log(`第${page}页返回 ${movies.length} 部影片`);
    return movies;
    
  } catch (error) {
    console.error(`搜索${params.company}系列失败:`, error);
    throw error;
  }
}
