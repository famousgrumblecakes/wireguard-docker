const { spawnSync } = require('child_process');
const { readFile, writeFileSync } = require('fs');
const { tmpdir } = require('os');
const {join} = require('path');

const { createHash } = require("crypto");

module.exports = class {
    

    constructor(){

    }


    async InitDB(){
        /*
         * I actually think that the info we care about is stored in the docker network info, so maybe we'll redo this later to just read out of that.
         * That way we're not storing the secrets in plaintext :)
         */
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
        // This basically adds a network space to Docker. Docker will later attempt to add things to this network, and the wgmanager will use its
        // stored wg info to build those interfaces.

        /**
         On the client system, new containers added to this network will have interfaces created for them at that time.
         On the gateway system, we need some indication from 
         */

        // This will come from a call by the [sb]m using the docker engine api to create a network.

        return new Promise((resolve, reject)=>{

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


    async CreateContainerEndpoint(networkID, address, endpointID)
    {

        //Used by docker engine to add a container to a network. When the container comes up, docker will ask the wgmanager to create and UP an interface for it.

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
            //Used by docker driver to add a container to the wg network, creates and UPs an interface that connects to a known-up peer.
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


                this.InstallClientInterface(network, endpoint).then((ifname)=>{

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
                    var ifname = this.db.n[networkID]['e'][endpointID].joined
                    delete this.db.n[networkID]['e'][endpointID]
                    this.SyncDB()
                    resolve(true)
                    setTimeout(UninstallInterface(ifname), 3000) //kinda gross, but wait a couple seconds for docker to return the interface to the os, then delete it
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


        async GetAvailablePort(){
            const net = require('net');

            return new Promise((resolve, reject)=>{
                var port = Math.floor(Math.random() * (5000 - 4000) + 4000)

                var server = net.createServer()
                    .once('error', () => {
                    //lmfao kill me now
                    this.GetAvailablePort().then((p)=>{
                        resolve(p)
                    })
                })
                    .once('listening', () => {
                        var port = server.address().port
                        server.once('close', () => {
                            resolve(port)

                        }).close();

                    }).listen();
            })
        }

        async InstallGatewayInterface(options)
        {
            /*
            * Create a wireguard gateway interface.
            * Uses secrets to create a peerless interface.
            * Result a wireguard interface for some subnet, this will remain attached to the host. equal to wg-out.conf
            * After this is created, we should update the db with peer=localhost:port and peerkey=pubkey of the new interface so that containers on this box can use it.
            */
            return new Promise((resolve, reject)=>{
                
                const IFPREFIX = 'bst';
                const ifname = `${IFPREFIX}${options['Salt']}`.slice(0, 15);
                
                try {
                spawnSync('ip', ['link', 'add', 'name', ifname, 'type', 'wireguard'], { stdio: 'ignore' });
                } catch (err) {
                    console.log(`[install interface]: error!`)
                    console.log(err)
                return null;
                }
            
                //spawnSync('ip', ['link'], { stdio: 'inherit' });
                //spawnSync('wg', [], { stdio: 'inherit' });
            
                var seed = options['Seed']
                var salt = options['Salt']
                //var address = endpoint['Address']
                /**
                 * Address in this case should be the first address in the subnet. The easiest way to glean this will be to
                 * take the subnet out of the network object, chop it up, and assuming it is a /30 or bigger just add one to the network address.
                 */
                var addr = ((network) => {

                    var [ip, mask] = network.split('/')

                    var bytes = ip.split('.').map(Number)
                    var numHosts = (2**(32-mask)) - 2;

                    bytes[3] += 1;
                    if(bytes[3] > 255)
                    {
                        bytes[2] += 1;
                        bytes[3] = 0;
                    }

                    return `${bytes.join('.')}/${mask}`

                    return {
                        address: bytes.join('.'),
                        mask: mask
                    }


                })(options['Network'])

                this.GetAvailablePort().then((port)=>{
                    console.log(`using port ${port}`)

                    this.GeneratePrivateKey(seed, salt, addr).then((key)=>{
                        const conf =
                            `
                            [Interface]
                            Address = ${addr}
                            PrivateKey = ${key}
                            ListenPort = ${port}
                            `.trim();
            
                        const tmpConfFile = join(__dirname, 'wg-conf-' + Date.now());
            
                        writeFileSync(tmpConfFile, conf, 'utf-8')
            
                        spawnSync('wg', ['setconf', ifname, tmpConfFile]);
                        spawnSync('wg',['showconf', ifname], { stdio: 'inherit' });
                        console.log(`Made it!`)
            
            
                        resolve({
                            port: port
                        });
            
                    }).catch((err)=>{
                        console.log(`[wgmanager]: failed to generate the private key`)
                        reject(err)
                    })    
                })





            })
        }

        async InstallClientInterface(network, endpoint) {
            /*
            * Create a wireguard client interface.
            * Uses known secrets + peer/gateway info to join an existing tunnel.
            * Result a wireguard interface that is preconfigured to connect to a gateway, and which will be moved to some container's netns.
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