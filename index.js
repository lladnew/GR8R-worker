// Cloudflare Worker: Airtable Proxy + EmailOctopus v1.5.0
//
// Changelog:
// - Removes 'tags' and 'status' from EO payload (not supported / unused)
// - Retains valid EO fields and logging for troubleshooting

export default {
  async fetch(request, env, ctx) {
    const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID, EO_API_KEY, EO_LIST_ID } = env;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const body = await request.json();
      const {
        firstName,
        lastName,
        emailAddress,
        phoneNumber,
        DeliveryPreference,
        CampaignInterest,
        source
      } = body;

      console.log("Incoming payload:", JSON.stringify(body, null, 2));

      // Airtable logic
      const headers = {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        "Content-Type": "application/json"
      };

      const searchUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}?filterByFormula={Email}='${emailAddress}'`;
      const searchRes = await fetch(searchUrl, { headers });
      const searchData = await searchRes.json();
      console.log("Search result:", JSON.stringify(searchData, null, 2));

      const now = new Date().toISOString();
      const tags = CampaignInterest?.split(",").map(tag => tag.trim()).filter(Boolean) || [];
      const delivery = ["Both", "Email", "Text"].includes(DeliveryPreference) ? DeliveryPreference : undefined;

      console.log("Normalized tags:", tags);
      console.log("Delivery preference:", delivery);

      const baseFields = {
        "First Name": firstName,
        "Last Name": lastName,
        "Email": emailAddress,
        "Phone number": phoneNumber
      };
      if (delivery) baseFields["Delivery Preference"] = delivery;
      if (tags.length > 0) baseFields["Campaign Interest"] = tags;

      if (!searchData.records || searchData.records.length === 0) {
        const fields = {
          ...baseFields,
          "Subscribed Date": now,
          "Source": source || "Direct",
          "Status": "Pending"
        };

        const createRes = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`, {
          method: "POST",
          headers,
          body: JSON.stringify({ fields })
        });

        const createResult = await createRes.json();
        console.log("Create result:", JSON.stringify(createResult, null, 2));
      } else {
        const record = searchData.records[0];
        const patchFields = {};
        for (const [key, value] of Object.entries(baseFields)) {
          if (value !== undefined && value !== "") {
            patchFields[key] = value;
          }
        }

        console.log("Updating record:", record.id);
        console.log("Patch payload:", JSON.stringify(patchFields, null, 2));

        const patchRes = await fetch(
          `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}/${record.id}`,
          {
            method: "PATCH",
            headers,
            body: JSON.stringify({ fields: patchFields })
          }
        );

        const patchResult = await patchRes.json();
        console.log("Patch result:", JSON.stringify(patchResult, null, 2));
      }

      // EmailOctopus logic (no tags, no status)
      const eoFields = {};
      if (firstName) eoFields.FirstName = firstName;
      if (lastName) eoFields.LastName = lastName;
      if (phoneNumber) eoFields.Phone = phoneNumber;
      if (delivery) eoFields.DeliveryPreference = delivery;
      if (tags.includes("Pivot Year")) eoFields.PivotYear = "yes";

      const eoPayload = {
        email_address: emailAddress,
        fields: eoFields
      };

      console.log("Sending to EmailOctopus:", JSON.stringify(eoPayload, null, 2));

      const eoRes = await fetch(
        `https://emailoctopus.com/api/1.6/lists/${EO_LIST_ID}/contacts?api_key=${EO_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(eoPayload)
        }
      );

      const eoResult = await eoRes.json();
      console.log("EmailOctopus result:", JSON.stringify(eoResult, null, 2));

      return new Response(JSON.stringify({ status: searchData.records.length ? "updated" : "created" }), {
        status: 200,
        headers: { "Access-Control-Allow-Origin": "*" }
      });

    } catch (error) {
      console.error("Error processing request:", error);
      return new Response("Internal Server Error", {
        status: 500,
        headers: { "Access-Control-Allow-Origin": "*" }
      });
    }
  }
};
