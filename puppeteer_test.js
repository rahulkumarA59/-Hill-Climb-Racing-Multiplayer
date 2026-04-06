const puppeteer = require('puppeteer');

(async () => {
    try {
        const browser = await puppeteer.launch();
        const page = await browser.newPage();
        
        page.on('console', msg => {
            if (msg.type() === 'error') {
                console.log('BROWSER ERROR:', msg.text());
            } else {
                console.log('BROWSER LOG:', msg.text());
            }
        });
        
        page.on('pageerror', err => {
            console.log('BROWSER PAGE ERROR:', err.toString());
        });

        console.log('Navigating to http://localhost:5173...');
        await page.goto('http://localhost:5173');
        
        // Wait for name input
        await page.waitForSelector('input[type="text"]');
        await page.type('input[type="text"]', 'TestUser');
        
        // Click Solo Mode
        const soloBtn = (await page.$x("//button[contains(., 'PLAY SOLO')]"))[0];
        if (soloBtn) await soloBtn.click();
        
        await new Promise(r => setTimeout(r, 1000));
        
        // Click BIKE
        const bikeBtn = (await page.$x("//button[contains(., 'BIKE')]"))[0];
        if (bikeBtn) await bikeBtn.click();
        
        // Let React state update
        await new Promise(r => setTimeout(r, 1000));
        
        // Click Map (Green Meadows)
        const mapCards = await page.$$('.map-card');
        if (mapCards.length > 0) {
            await mapCards[0].click();
        }
        
        await new Promise(r => setTimeout(r, 1000));
        
        // Click Start Race
        const startBtn = (await page.$x("//button[contains(., 'START RACE')]"))[1] || (await page.$x("//button[contains(., 'START RACE')]"))[0];
        if (startBtn) await startBtn.click();
        else console.log('Could not find START RACE button');
        
        // Wait to capture errors during GameScene initialization
        await new Promise(r => setTimeout(r, 2000));
        
        await browser.close();
    } catch (e) {
        console.log("PUPPETEER ERROR:", e);
    }
})();
