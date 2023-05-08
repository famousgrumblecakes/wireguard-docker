const { spawnSync } = require('child_process');
const { readFile, writeFileSync } = require('fs');
const { tmpdir } = require('os');
const {join} = require('path');

const { createHash } = require("crypto");

module.exports = class {
    

    constructor(){

    }


    async InitDB(){
        return new Promise((resolve, reject)=>{
            readFile('./wgdb.dat', { encoding: 'utf8', flag: 'r' }, (err, jsonData)=>{
                if(err)
                {
                    //file maybe didn't exist, that's fine
                    this.db = {
                        'n': {}
                    }

                    this.SyncDB()
                }else
                {
                    try {
                        this.db = JSON.parse(jsonData)
                    } catch (error) {
                        //file was bad.
                        writeFileSync('./wgdb.bak', JSON.stringify(jsonData), 'utf-8')
                        console.log(`[storage]: error: ${error} ; made a backup of the old data, proceeding with a new db`)
                        this.db = {
                            'n': {}
                        }

                        this.SyncDB()

                    }
                }
                resolve(true)
            })

            


        })
    }

    SyncDB()
    {
        try{
            writeFileSync('./wgdb.dat', JSON.stringify(this.db), 'utf-8')
            console.log(`[storage]: synced data to disk!`)
            return true
        }catch(err){
            return false
        }

    }



    async CreateNetwork(options, networkID)
    {
        return new Promise((resolve, reject)=>{

            /*
             * we should be able to figure out the server's key 
             * using the 
             */


            this.db.n[networkID] = {
                Peer: options['wg.peer'],
                PeerKey: options['wg.peerkey'],
                Seed: options['wg.seed'],
                Salt: options['wg.salt'],
                id: networkID,
                e: {}
            }
            this.SyncDB()

            resolve(true)

        })



    }

    DeleteNetwork(networkID){
        return new Promise((resolve, reject)=>{

            if(this.db.n[networkID])
            {
                delete this.db.n[networkID]
                this.SyncDB()

                resolve(true)
            }else
            {
                console.log(`network didn't exist`)
                resolve(false)
            }

        })
    }


    async CreateEndpoint(networkID, address, endpointID)
    {
        return new Promise((resolve, reject)=>{

            console.log(this.db)
            this.db.n[networkID]['e'][endpointID] = {
                Address: address,
                id: endpointID,
                joined: undefined
            }
            this.SyncDB()

            resolve(true)

        })
    }

    async DeleteEndpoint(networkID, endpointID)
    {
        return new Promise((resolve, reject)=>{

            if(this.db.n[networkID] && this.db.n[networkID]['e'][endpointID])
            {
                delete this.db.n[networkID]['e'][endpointID]
                this.SyncDB()

                resolve(true)
            }else
            {
                reject("networkID or endpointID didn't exist")
            }
        })
    }

    async Join(networkID, endpointID)
    {
        return new Promise((resolve, reject)=>{

            try {
                
                var network = this.db.n[networkID]
                var endpoint = this.db.n[networkID]['e'][endpointID]


            } catch (error) {
                reject(error) //either network or endpoint didn't exist in the db
            }

            if(endpoint['joined'] == true)
            {
                reject(false) //endpoint was already joined
            }


            this.InstallInterface(network, endpoint).then((ifname)=>{

                endpoint.joined = ifname
                this.db.n[networkID]['e'][endpointID] = endpoint
                this.SyncDB()


                resolve(ifname)

            }).catch((err)=>{
                console.log(`[wgmanager]: failed to create the interface`)
                reject(err) //failed to create the interface
            })


        })
    }

    async Leave(networkID, endpointID)
    {
        return new Promise((resolve, reject)=>{

            if(this.db.n[networkID]['e'][endpointID])
            {
                delete this.db.n[networkID]['e'][endpointID]
                this.SyncDB()
                resolve(true)
            }else{
                //this endpoint didn't exist
                reject(false)
            }
        })
    }


    async GeneratePrivateKey(seed, salt, address)
    {
        /*
            Generate a curve25519 key
        */
        return new Promise((resolve, reject)=>{
            console.log(address)
            console.log(seed)
            console.log(salt)
            const hash = createHash("sha3-256")
                .update(seed + address)
                .update( 
                    createHash('sha3-256')
                        .update(salt)
                        .digest()
                    )
                .digest()

            var curve25519 = Buffer.from(hash)

            curve25519.writeUInt8()

            curve25519.writeUInt8((curve25519.readUInt8(0) & 0b11111000), 0)
            curve25519.writeUInt8(((curve25519.readUInt8(31) & 0b01111111) | 0b01000000), 31)


            curve25519 = curve25519.toString('base64').toString('ascii')
            
            console.log(`[crypto]: Generated key ${curve25519}`)

            resolve(curve25519)
            
        })
    }

    async UninstallInterface(ifname)
    {
        return new Promise((resolve, reject)=>{

            spawnSync('ip', ['link', 'delete', ifname])

        })
    }

    async InstallInterface(network, endpoint) {

        /*
         * Create a wireguard interface
         */
        return new Promise((resolve, reject)=>{
            
        const IFPREFIX = 'bst';
        const ifname = `${IFPREFIX}${endpoint['id']}`.slice(0, 15);
        
        try {
          spawnSync('ip', ['link', 'add', 'name', ifname, 'type', 'wireguard'], { stdio: 'ignore' });
        } catch (err) {
            console.log(`[install interface]: error!`)
            console.log(err)
          return null;
        }
      
        //spawnSync('ip', ['link'], { stdio: 'inherit' });
        //spawnSync('wg', [], { stdio: 'inherit' });
      
        var seed = network['Seed']
        var salt = network['Salt']
        var address = endpoint['Address']

        this.GeneratePrivateKey(seed, salt, address).then((key)=>{
            const conf =
`
[Interface]
PrivateKey = ${key}

[Peer]
PublicKey = ${network['PeerKey']}
AllowedIPs = 0.0.0.0/0
Endpoint = ${network['Peer']}
PersistentKeepalive = 25
`.trim();

            const tmpConfFile = join(tmpdir(), 'wg-conf-' + Date.now());

            writeFileSync(tmpConfFile, conf, 'utf-8')

            spawnSync('wg', ['setconf', ifname, tmpConfFile]);
            spawnSync('wg',['showconf', ifname], { stdio: 'inherit' });
            console.log(`Made it!`)


            resolve(ifname);

        }).catch((err)=>{
            console.log(`[wgmanager]: failed to generate the private key`)
            reject(err)
        })

    })
    }


}