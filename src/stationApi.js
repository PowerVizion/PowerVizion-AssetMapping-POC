const API='http://127.0.0.1:4000/api';
export async function stationRequest(path='',options={}) {
 const response=await fetch(`${API}/terrestrial-stations${path}`,{...options,headers:{'Content-Type':'application/json',...options.headers}});
 const body=await response.json();if(!response.ok)throw new Error(body.error||'Station request failed');return body;
}
