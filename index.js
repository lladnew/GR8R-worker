// Cloudflare Worker: Airtable Proxy + EmailOctopus + WhySubscribe v1.6.0
//
// Changelog:
// - v1.6.0: Adds /api/whysubscribe POST endpoint
//           Handles checkOnly lookup for email existence
//           Appends to 'whysubscribe' long text field if response is submitted
//           Sends MailerSend alert to info@gr8terthings.com
//           Does NOT block duplicates — all responses are appended

export default {
  async fetch(request, env, ctx) {
    const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID, EO_API_KEY, EO_LIST_ID, MAILERSEND_API_KEY } = env;
    const url = new URL(request.url);

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

    // 🔁 Handle /api/whysubscribe separately
    if (url.pathname === "/api/whysubscribe" && request.method === "POST") {
      try {
        const { email, checkOnly, response } = await request.json();

        if (!email) {
          return new Response(JSON.stringify({ error: "Missing email" }), {
            status: 400,
            headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }
          });
        }

        // Lookup subscriber in Airtable
        const headers = {
          Authorization: `Bearer ${AIRTABLE_TOKEN}`,
          "Content-Type": "application/json"
        };
        const searchUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}?filterByFormula={Email}='${email}'`;
        const searchRes = await fetch(searchUrl, { headers });
        const searchData = await searchRes.json();

        if (!searchData.records || searchData.records.length === 0) {
          return new Response(JSON.stringify({ found: false }), {
            status: 200,
            headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }
          });
        }

        const record = searchData.records[0];

        if (checkOnly) {
          return new Response(JSON.stringify({ found: true }), {
            status: 200,
            headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }
          });
        }

        // Append response to 'whysubscribe' field
        const now = new Date().toISOString();
        const existing = record.fields["whysubscribe"] || "";
        const appended = `${existing}\n\n[${now}]\n${response}`;

        const patchRes = await fetch(
          `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}/${record.id}`,
          {
            method: "PATCH",
            headers,
            body: JSON.stringify({ fields: { "whysubscribe": appended } })
          }
        );

        const patchResult = await patchRes.json();
        console.log("Appended to Airtable:", JSON.stringify(patchResult, null, 2));

        // Send MailerSend alert
        const alertRes = await fetch("https://api.mailersend.com/v1/email", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${MAILERSEND_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from: { email: "no-reply@gr8terthings.com", name: "Gr8terThings Alerts" },
            to: [{ email: "info@gr8terthings.com", name: "Gr8terThings" }],
            subject: `New WhySubscribe response from ${email}`,
            text: `The subscriber ${email} just submitted the following response:\n\n${response}`
          })
        });

        const alertJson = await alertRes.json();
        console.log("MailerSend response:", JSON.stringify(alertJson, null, 2));

        return new Response(JSON.stringify({ status: "appended" }), {
          status: 200,
          headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }
        });

      } catch (err) {
        console.error("Error in /api/whysubscribe:", err);
        return new Response("Server error", {
          status: 500,
          headers: { "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // Default: original handler (subscribe form)
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

      const headers = {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        "Content-Type": "application/json"
      };

      const searchUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}?filterByFormula={Email}='${emailAddress}'`;
      const searchRes = await fetch(searchUrl, { headers });
      const searchData = await searchRes.json();

      const now = new Date().toISOString();
      const tags = CampaignInterest?.split(",").map(tag => tag.trim()).filter(Boolean) || [];
      const delivery = ["Both", "Email", "Text"].includes(DeliveryPreference) ? DeliveryPreference : undefined;

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

      const searchEO = await fetch(
        `https://emailoctopus.com/api/1.6/lists/${EO_LIST_ID}/contacts/${encodeURIComponent(emailAddress)}?api_key=${EO_API_KEY}`,
        { method: "GET" }
      );

      if (searchEO.status === 200) {
        const existing = await searchEO.json();
        const updateRes = await fetch(
          `https://emailoctopus.com/api/1.6/lists/${EO_LIST_ID}/contacts/${existing.id}?api_key=${EO_API_KEY}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields: eoFields })
          }
        );
        const updateResult = await updateRes.json();
        console.log("EO Patch Result:", JSON.stringify(updateResult, null, 2));
      } else {
        const createRes = await fetch(
          `https://emailoctopus.com/api/1.6/lists/${EO_LIST_ID}/contacts?api_key=${EO_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(eoPayload)
          }
        );
        const createResult = await createRes.json();
        console.log("EO Create Result:", JSON.stringify(createResult, null, 2));
      }

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
