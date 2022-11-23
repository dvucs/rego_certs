module.exports.validar = sha=>{
    return `
    SELECT 
        '${sha}'
    FROM 
        dual
    `;
}