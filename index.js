
const { Client } = require('discord.js-selfbot-v13');
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

const client = new Client({
    checkUpdate: false
});

client.login(process.env.TOKEN);

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
})
let queue = [];
let queueInterval = 0

async function getModels() {
    const { data } = await axios.get("https://sd.nigga.no/get/models")
    return data.options["stable-diffusion"]
}

// ===========
// DEBUG: set height and width low so gen faster
let debug = false
let num_inference_steps = 25


let model = "sd-v1-4"
client.on('messageCreate', async (message) => {


    // ignore bots
    if (message.author.bot) return;

    // prepare args
    const args = message.content.split(" ");
    if (args[0] != "?sd") return;

    // remove prefix and command from args
    args.shift();

    if (args[0] === "model") {
        args.shift()
        if(args[0] === "set") {
            args.shift()
            const models = await getModels()
            const chosenModel = args[0]
            if(!models.includes(chosenModel)) return message.reply({ content: "Invalid model\nValid models are " + models.join(", "), allowedMentions: { repliedUser: true }})
            model = chosenModel
            return message.channel.send(`Model set to: **${chosenModel}**`)
        } else {
            return message.channel.send(`Current model is: **${model}**`)
        }
    }

    if(args[0] === "debug") {
        debug = !debug
        return message.channel.send(`Debug mode set to: **${debug}**`)
    }

    if(args[0] === "queue") {
        if (args[1] === "clear") {
            queue = []
            queueInterval = 0
            return message.channel.send("Cleared the queue.")
        }
        if (queue.length == 0) return message.channel.send("The queue is empty.")
        let queueStr = "The queue is:\n"
        queue.forEach((obj, i) => {
            queueStr += `**${i+1}.** \`${obj.prompt}\` requested by ${obj.message.author.username}\n`
        })
        return message.channel.send(queueStr)
    }

    const prompt = args.join(" ");
    if (!prompt) return message.channel.send("Please provide a prompt.");

    const seed = new Date().getTime();
    return generateImage(prompt, seed, message);


});

async function getStatus() {
    const res = await axios.get("https://sd.nigga.no/ping?session_id=1682366180601");
    return res.data
}

let busy = false
async function generateImage(prompt, seed, message){


    const data = await getStatus();
    if (data.status == "Rendering" || busy) {

        const queueObj = {
            prompt: prompt,
            message: message,
            seed: seed,
            position: queueInterval++
        }

        if (queue.length > 10) {
            return message.reply({ content: "The queue is full. Please try again later.", allowedMentions: { repliedUser: true }})
        }
        queue.push(queueObj);
        return message.reply({ content: `Renderer is busy right now. You've been added to the queue.\nQueue position: ${queueInterval} `, allowedMentions: { repliedUser: true }})
    }


    busy = true
    const initReply = await message.reply({ content: "Generating image...", allowedMentions: { repliedUser: true }})
    let res

    let height = 512
    let width = 512

    if (debug) {
        height = 128
        width = 128
    }

    try {
        res = await axios.post("https://sd.nigga.no/render", {
            active_tags: [],
            block_nsfw: false,
            guidance_scale: 7.5,
            height,
            width,
            inactive_tags: [],
            metadata_output_format: "none",
            negative_prompt: "",
            num_inference_steps,
            num_outputs: 1,
            original_prompt: prompt,
            output_format: "jpeg",
            output_lossless: false,
            output_quality: 80,
            prompt,
            sampler_name: "euler_a",
            seed,
            session_id: "1682366180601",
            show_only_filtered_image: true,
            stream_image_progress: false,
            stream_progress_updates: true,
            use_stable_diffusion_model: model,
            use_vae_model: "",
            used_random_seed: true,
            vram_usage_level: "balanced",
        })
    } catch (e) {
        console.log(e)
    }
    probeResponse(res.data, message, initReply).then((result) => {
        let base64String = result.data.output[0].data; // Not a real image
        // Remove header
        let base64Image = base64String.split(';base64,').pop();
    
    
        fs.writeFile(`/home/ftpuser/sd/${result.data.task_data.request_id}.jpeg`, base64Image, {encoding: 'base64'}, function(err) {
            if (err) {
                console.log(err);
            }
            setTimeout(() => result.reply.delete(), 1500);
            return message.reply({ content: `Here is your image:\nhttps://cdn.metrix.pw/sd/${result.data.task_data.request_id}.jpeg`, allowedMentions: { repliedUser: true }})
        });
    }).catch((err) => { 
        return message.channel.send("Failed with error: " + err.detail)
    })
}

async function probeResponse(data, message, initReply) {
    const url = `https://sd.nigga.no${data.stream}`
    if (!initReply) {
        initReply = await message.reply({ content: "Generating image...", allowedMentions: { repliedUser: true }})
    }

    return new Promise((resolve, reject) => {
        let interval;
        let oldStep = 100;
        const bar_len = num_inference_steps
        interval = setInterval(async () => {
            const res = await axios.get(url)
          
            const time = timeRemaining(res.data.step, res.data.step_time, res.data.total_steps)

            if (res.data.status === "succeeded") {
                initReply.edit(`Step: ${num_inference_steps} of ${num_inference_steps} (100%)\n║█████████████████████████║`)
                busy = false
                const result = {
                    data: res.data,
                    reply: initReply
                }
                resolve(result)
                handleQueue()
                clearInterval(interval)
            }

            if (res.data.status === "failed") {
                busy = false
                const result = {
                    data: res.data,
                    reply: initReply
                }
                reject(result)
                handleQueue()
                clearInterval(interval)
            }

            if (res.data.step != oldStep && res.data.step != undefined) {
                const filled_len = (res.data.step * res.data.total_steps / num_inference_steps).toFixed(0)
                const bar = '║' + '█'.repeat(filled_len) + '░'.repeat((bar_len - filled_len).toFixed(0)) + '║'
                initReply.edit(`Step: ${res.data.step} of ${res.data.total_steps} (${(res.data.step * 100 / res.data.total_steps).toFixed(0)}%) Approx. ${time.minutes}m ${time.seconds}s remaining\n${bar}`)
                oldStep = res.data.step
            }

        }, 750)
      });
} 

async function handleQueue() {
    if (queue.length > 0) {
        const queueObj = queue.shift();
        queueInterval--;
        generateImage(queueObj.prompt, queueObj.seed, queueObj.message);
    }
}


let oldTime;
function timeRemaining (step, step_time, total_steps) {
    const time = (total_steps - step) * step_time
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    
    // if the variable time is negative, return nan
    if (time < 0) {
        return { minutes: "??", seconds: "??" }
    }

    if (isNaN(minutes) || isNaN(seconds)) {
        return oldTime
    }

    oldTime = { minutes, seconds }
    return { minutes, seconds }
}


