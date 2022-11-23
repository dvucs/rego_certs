//------ requires varios ------
const express = require('express');
const oracledb = require('oracledb');
const crypto = require('crypto'); //<-- para generar las UUIDs cuando a consulta() le pasan la option.discard_unkeyed = false (default: true)

//para mandar colorincherío en los consoles logs
const conColor = require('./console_colors.js');

// gilada para usar un caracter como patron para dividir la pantalla de salida en el console.log
const divisor = ((caracter = "#",repetir=1)=>{while(repetir--){console.log(caracter.repeat(process.stdout.columns))}});

//------ inicializamos el oracle instant client ------
try {
    console.log('\n\n');
    divisor("_",2);
    console.log('Inicializando el cliente oracle...');
    oracledb.initOracleClient();
  } catch (err) {
    console.error(conColor.Red,'Error al iniciar el cliente de Oracle');
    console.error(err);
    process.exit(1);
  }

//------ instancio la app express ------
const app = express()

//------ inicializaciones/configuraciones varias ------
const api_root = process.env.API_ROOT || '/v1'
const port = process.env.APP_PUERTO
const entorno = process.env.APP_ENTORNO || 'desarrollo';
const mostrar_errores = (process.env.APP_MOSTRAR_ERRORES == 'true') || false;

let conexion;
let pool = {}; //<-- en este caso es un JSON porque en éste endpoint tendremos que usar dos usuarios APP_GESTION y APP_AFIP... -.-  ... yaaaass... I don't make the rules :( 
oracledb.autoCommit = true;
oracledb.errorUrl = true;
oracledb.fetchAsString = [ oracledb.CLOB ];

//------ nos conectamos a la BD ------
async function conectarse() {
    try {
        let connectString;
        let iPool = 0;
        let arUsuarios = process.env.DB_USUARIO.split(',');
        let arClaves = process.env.DB_CLAVE.split(',');
        
        if (arUsuarios.length != arClaves.length){
            divisor("#",2);
            console.log(conColor.Red,'############ NO COINCIDEN LA CANTIDAD DE USUARIOS CON LA CANTIDAD DE CLAVES ########### ',conColor.White);
            divisor("#",2);
            return false;
        };

        if (process.env.DB_URL_CONEXION){
            connectString = process.env.DB_URL_CONEXION;
        }else{
            process.exit //<-- this part is removed on this repo
        };

        console.log('\n\n\n\n\n\n Creando pool de conexiones en: ------> ',conColor.Cyan,connectString,conColor.White);
        arUsuarios.forEach((usuario)=>{
            clave = arClaves.shift();
            pool[usuario] = oracledb.createPool({
                user: usuario,
                password: clave,
                connectString : connectString,
                poolMin: parseInt(process.env.DB_POOL_MIN || 1),
                poolMax: parseInt(process.env.DB_POOL_MAX || 10),
                poolIncrement: parseInt(process.env.DB_POOL_INCREMENT || 1),
            }).then(p=>pool[usuario] = p);
            
            //la primera conexión es la conexión .default ya que la función consulta() si no le pasan parámetro de qué pool usar, usa el indicado por pool.default
            if (!pool?.default){
                pool.default = usuario;
            };

            iPool++;
            console.log(conColor.White,`POOL ${iPool}/${arUsuarios.length} CONECTADO COMO ---------> `,conColor.Green, usuario,conColor.Yellow,(iPool == 1?' (default)':''),conColor.White);
        });
        
        console.log(conColor.White,'ERRORES ---------> ',(mostrar_errores?conColor.Green:conColor.Red), (mostrar_errores?"MOSTRADOS":"OCULTOS"),conColor.White);
        console.log(conColor.White,'ENTORNO ---------> ',(entorno=='produccion'?conColor.Red:conColor.Green), entorno,' \n\n\n\n\n\n',conColor.White);
    } catch (err) {
        console.log(conColor.Red,'ERROR AL CREAR EL POOL',conColor.White,' ---------> \n');
        console.log(conColor.Red,err,'\n\n\n',conColor.White);
    }
}; //<-- de la function contectarse

async function consulta(query,options = {},callback = null){
    let salida = [];
    let params = [];
    let error = false;
    //por las porsias ponemos el valor por defecto del options.discard_unkeyed = true (esto implica que cualquier row que no tenga la propiedad key será ignorado)
    if (!options.hasOwnProperty('discard_unkeyed')){
        options.discard_unkeyed = true;
    };
    if (options?.pool){
        conexion = await pool[options.pool].getConnection();
    }else{
        conexion = await pool[pool.default].getConnection();
        console.warn(conColor.Yellow,`--- usando pool por defecto (${pool.default}) --- `,conColor.White);
    };

    if (options.hasOwnProperty('params')){
        params = options.params;
    };

    try {
        if (callback){
            result = await conexion.execute(query,params,callback);
        }else{
            result = await conexion.execute(query,params,{ resultSet: true, outFormat: oracledb.OUT_FORMAT_OBJECT });
        };

        //return result;

        const rs = result?.resultSet;
        //vemos si se trata de un resultset o de un string solo
        if (rs){
            let row;
            if (!options.hasOwnProperty('key')){
                //si no especifica key entro por aqui para no andar haciendo que pase por el if al vicio
                while ((row = await rs.getRow())) {
                    salida.push(row);
                };//<-- del while
            }else{
                let key = options.key;
                let key_ya_existe;
                let tiene_key;
                salida = {};
                
                while ((row = await rs.getRow())) {
                    tiene_key = row[key] || false;
                    if (tiene_key){
                        key_ya_existe = salida[row[key]] || false;
                        if (!key_ya_existe){
                            salida[row[key]]=[];
                        };
                        salida[row[key]].push(row);
                    }else{
                        //me fijo si es que tengo que descartar o asignarle un uuid a los rows que no tienen el key esperado
                        if (!options.discard_unkeyed){
                            salida[crypto.randomUUID()] = {row};
                        };
                    };
                };//<-- del while
            };
            await rs.close();
        }else{
            salida = result;
        }
    } catch (err) {
        let divisor = '\n\n-----------------------------------------------------------------------\n\n';
        error = {error:true,code:err,message:err?.message,errorTraceId:crypto.randomUUID()};
        console.error(conColor.Red, error);
        console.log(divisor+' QUERY:\n',query,divisor,conColor.White);
        if (!mostrar_errores){error=[]};
    };
    conexion.close();
    return !error?salida:error;
}; //<-- de la function consulta

//------ las rutas ------
//! ------ PARA EL HEALTHCHECK DEL DOCKER ------
app.get (`${api_root}/healthcheck_dd5fe42e6f60ac50e4139e75467fbeeecc26381e`, (req, res) => {
    res.status(200).json({health:"ok"});
})

//! ------ PARA OBTENER LA SPEC DE LA API ------
app.get (`${api_root}/spec.yaml`, (req, res) => {
    const fs = require("fs");    
    try {
        res.send(fs.readFileSync("./spec.yaml"));
    } catch (error) {
        res.send(`
            swagger: "2.0"
            info:
                description: "No hay definición de la API disponible, póngase en contacto con el área de sistemas"
                title: "Error"
                contact:
                    email: "--------@ucasal.edu.ar"
            basePath: "${api_root}"
        `);
    };
});

app.get (`${api_root}`, (req, res) => {
    res.send(`
        <!doctype html>
        <html>
        <head>
            <meta charset="utf-8"> 
            <script type="module" src="//unpkg.com/rapidoc/dist/rapidoc-min.js"></script>
        </head>
        <body>
            <rapi-doc
                spec-url = "${api_root}/spec.yaml"
                theme = "dark"
                render-style = "read"
                allow-try="false"
                show-header = "false"
                allow-authentication="false"
            > 
            <script>
                if (document.location.href.split("#")[1] != "overview"){
                    document.location = "#overview";
                };
            </script>
            </rapi-doc>
        </body>
        </html>
    `);
})

//? ------ LAS RUTAS DE LA API EN CUESTIÓN ------

app.get(`${api_root}/validar/:validador/:sha`, async (req, res) => {
    //saneamos lo que llegue como supuesto sha
    let sha = req.params.sha.match(/^[a-f0-9]{64}$/gi);
    
    //validamos o mostramos error
    try{
        let q = require(`./validadores/${req.params.validador}`).validar(sha)
        salida = await consulta(q);
    }catch(err){
        res.status(400).json({error:true,message:`Validador inexistente`});
        return false;
    };

    if (salida.length){
        //acondicionamos la salida para que cumpla con el contract
        salida = {items:salida};
    };
    
    res.json(salida);
})

//! ################## ARRANCO LA APP ##################
app.listen(port, () => {
    //hacemos que se conecte
    conectarse()
    //mandamos log a la consola como para indicar que arrancamos bien
    console.log(conColor.White,`Escuchando en el puerto ------> `,conColor.Green,port,conColor.Yellow," (dentro de docker)",conColor.White)
    divisor("_",2);console.log('\n\n');
})