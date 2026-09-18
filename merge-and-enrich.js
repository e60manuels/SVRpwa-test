const fs = require('fs');

const NEW_DATA_PATH = './data/campings.json';
const OLD_ENRICHED_PATH = './data/campings_enriched-backup.json';
const NEW_ENRICHED_PATH = './data/campings_enriched.json';

function merge() {
    try {
        const newData = JSON.parse(fs.readFileSync(NEW_DATA_PATH, 'utf8'));
        const oldEnriched = JSON.parse(fs.readFileSync(OLD_ENRICHED_PATH, 'utf8'));
        
        console.log(`Loaded ${newData.campings.length} new campings and ${oldEnriched.campings.length} old enriched entries.`);

        const enrichedCampings = newData.campings.map(newCamping => {
            // Try to find the old enriched version by ID or Name/City combo
            const oldMatch = oldEnriched.campings.find(c => c.id === newCamping.id) || 
                             oldEnriched.campings.find(c => c.naam === newCamping.naam && c.stad === newCamping.stad);
            
            if (oldMatch) {
                // Keep the old enriched data (svr_id, images, etc.)
                return { ...newCamping, ...oldMatch };
            }
            return newCamping;
        });

        const finalOutput = {
            updated: new Date().toISOString(),
            version: "0.2.88",
            campings: enrichedCampings
        };

        fs.writeFileSync(NEW_ENRICHED_PATH, JSON.stringify(finalOutput, null, 2));
        console.log(`Successfully merged data into ${NEW_ENRICHED_PATH}`);

        // Report missing enrichment
        const missing = enrichedCampings.filter(c => !c.svr_id);
        console.log(`Campsites still missing svr_id: ${missing.length}`);
        
    } catch (err) {
        console.error('Merge failed:', err.message);
    }
}

merge();
