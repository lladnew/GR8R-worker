// v1.6.3 Cloudflare Worker: Airtable Proxy + EmailOctopus + MailerSend + WhySubscribe 
//
// Changelog:
// - PRESERVED all logic from v1.6.2
// - ADDED double opt-in email via MailerSend on Status: Pending
// - RETAINED EmailOctopus logic for now

export default {
  async fetch(request, env, ctx) {
    const {
      AIRTABLE_TOKEN,
      AIRTABLE_BASE_ID,
      AIRTABLE_TABLE_ID,
      EO_API_KEY,
      EO_LIST_ID,
      MAILERSEND_API_KEY
    } = env;

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

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    if (url.pathname === "/api/whysubscribe") {
      try {
        const body = await request.json();
        const { email, response, checkOnly } = body;

        if (!email) {
          return new Response(JSON.stringify({ error: "Missing email" }), {
            status: 400,
            headers: { "Access-Control-Allow-Origin": "*" }
          });
        }

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
            headers: { "Access-Control-Allow-Origin": "*" }
          });
        }

        const record = searchData.records[0];
        const recordId = record.id;

        if (checkOnly) {
          return new Response(JSON.stringify({ found: true }), {
            status: 200,
            headers: { "Access-Control-Allow-Origin": "*" }
          });
        }

        const existing = record.fields["whysubscribe"] || "";
        const timestamp = new Date().toISOString();
        const appendText = `${existing}\n\n[${timestamp}]\n${response}`;

        const patchRes = await fetch(
          `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}/${recordId}`,
          {
            method: "PATCH",
            headers,
            body: JSON.stringify({ fields: { whysubscribe: appendText } })
          }
        );

        const patchResult = await patchRes.json();
        console.log("Appended to Airtable:", JSON.stringify(patchResult, null, 2));

        try {
          const emailAlert = {
            from: { email: "no-reply@gr8terthings.com", name: "Gr8terThings" },
            to: [{ email: "info@gr8terthings.com" }],
            subject: `New WhySubscribe Response: ${email}`,
            text: `Email: ${email}\n\n---\n\n${response}`
          };

          const mailerRes = await fetch("https://api.mailersend.com/v1/email", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${MAILERSEND_API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(emailAlert)
          });

          const mailerJson = await mailerRes.json();
          console.log("MailerSend response:", mailerJson);
        } catch (mailerErr) {
          console.warn("MailerSend failed:", mailerErr);
        }

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Access-Control-Allow-Origin": "*" }
        });
      } catch (error) {
        console.error("Error in /api/whysubscribe:", error);
        return new Response("Internal Server Error", {
          status: 500,
          headers: { "Access-Control-Allow-Origin": "*" }
        });
      }
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

        if (MAILERSEND_API_KEY && firstName && emailAddress) {
          const confirmEmail = {
            template_id: "zr6ke4ne1yy4on12",
            from: {
              email: "chad.mowery@gr8terthings.com",
              name: "Chad from GR8R"
            },
            to: [{ email: emailAddress, name: firstName }],
            variables: [
              {
                email: emailAddress,
                substitutions: [
                  {
                    var: "subscriber.first_name",
                    value: firstName
                  },
                  {
                    var: "subscriber.email",
                    value: emailAddress
                  }
                ]
              }
            ]
          };

          const sendRes = await fetch("https://api.mailersend.com/v1/email", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${MAILERSEND_API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(confirmEmail)
          });

          const sendJson = await sendRes.json();
          console.log("Double opt-in send result:", sendJson);
        }
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

      // EO logic retained below
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

      console.log("EO Payload:", JSON.stringify(eoPayload, null, 2));

      const searchEO = await fetch(
        `https://emailoctopus.com/api/1.6/lists/${EO_LIST_ID}/contacts/${encodeURIComponent(emailAddress)}?api_key=${EO_API_KEY}`,
        { method: "GET" }
      );

      if (searchEO.status === 200) {
        const existing = await searchEO.json();
        console.log("EO Contact Found. Updating…");
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
        console.log("EO Contact Not Found. Creating new…");
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
