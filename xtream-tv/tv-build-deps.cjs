const fs=require('node:fs');const path=require('node:path');const {createRequire}=require('node:module');
const localProject=path.resolve(__dirname,'..');
const project=process.env.JELLYFIN_TIZEN_PROJECT || (fs.existsSync(path.join(localProject,'config.xml'))?localProject:'D:/Dev/Tools/Jellyfin/jellyfin-tizen');
const web=process.env.JELLYFIN_WEB_PROJECT || path.resolve(project,'..','jellyfin-tizen.build-deps','jellyfin-web');
module.exports={project,web,req:createRequire(path.join(web,'package.json'))};
