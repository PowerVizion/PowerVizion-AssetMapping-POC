export const devOrigins=new Set(['http://127.0.0.1:5173','http://localhost:5173']);
export const allowedDevOrigin=origin=>devOrigins.has(origin);
export function devCors(req,res,next) {
 const origin=req.get('origin');res.vary('Origin');
 if(allowedDevOrigin(origin))res.set('Access-Control-Allow-Origin',origin);
 res.set('Access-Control-Allow-Headers','Content-Type, Range');
 res.set('Access-Control-Allow-Methods','GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS');
 if(req.method==='OPTIONS')return res.sendStatus(origin&&!allowedDevOrigin(origin)?403:204);
 next();
}
