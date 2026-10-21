const el = document.getElementById("register");
const data = el ? JSON.parse(el.textContent) : { records: {} };

export const record = (id) => data.records[id] || { state: "absent" };
export const isStated = (id) => record(id).state === "stated";
