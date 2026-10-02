---
title: Exploring Land Cover Change Interactions with Environmental and Socioeconomic Factors in a Tropical Region due to Rapid Agricultural Increase
abbreviations:
    GDP: Gross Domestic Product
    NPP: Net Primary Productivity
    LST: Land Surface Temperature
    LULCC: Land Use and Land Cover Change
abstract: |
    Mato Grosso, a vital part of the Amazonian Rainforest, has experienced a considerable human impact, primarily driven by agricultural expansion. The region, which once covered almost 50% with forests, has now dwindled to approximately 35%, largely due to deforestation linked to economic growth. Our study, utilizing MODIS satellite data and economic variables, revealed concerning trends, including a 7% reduction in forested areas and a simultaneous increase in croplands and grasslands between 2001 and 2021. Correlation analyses exposed negative associations between forested areas and both environmental (Net Primary Productivity - NPP, Land Surface Temperature - LST, albedo) and socioeconomic (Gross Domestic Product - GDP, population) variables, emphasizing a direct link between economic development and deforestation. Notably, the strong correlation between 'soy-planted area' and GDP/population highlights the significant role of agricultural expansion, often tied to deforestation, in regional economic growth. Additionally, the connection between the rise in LST and significant correlations between NPP and economic variables underscores the intricate relationship between land cover changes, environmental factors, and socio-economic development in Mato Grosso. This study can be useful for decision-makers, fostering awareness and guiding the creation of a mindful approach to reduce expansive agriculture, ultimately contributing to conservation efforts in the Amazonia region.
---

# Seminar presentation
```{iframe} https://www.youtube.com/embed/Mjw4j0LdTps
:width: 100%

This article was presented as part of a series of seminars chaired by scientists from Climatematch Academy’s collaborating organizations, CMIP (Couple Model Intercomparison Project) and LEAP (Learning the Earth with Artificial Intelligence and Physics).
```



# Claim

This research highlights the significant influence of rapid agricultural expansion on changes in land use and land cover within a tropical region undergoing transformation. The complex interaction between climatic variables and socioeconomic factors reveals a dynamic that intrinsically shapes the evolving landscape of this fast-paced agricultural environment.

# Introduction

Land use and land cover change (LULCC), including land management, is considered a driver of climate change due to its capacity to alter climate by disrupting natural cycles of carbon, water, and energy ([](doi:10.1038/nclimate2196), [](doi:10.5194/esd-8-369-2017), [](doi:10.1007/s10980-021-01276-w)). It is understood that the biogeophysical and biogeochemical effects of land management impact both local weather patterns and broader climate dynamics ([](doi:10.1111/pce.12488)).

Socioeconomic factors, such as urbanization, and agriculture expansion are key drivers of LULCC; and these changes can alter the surface energy balance and radiation budget, leading to changes in Land Surface Temperature (LST) ([](doi:10.3390/land12071294)). However, previous research has not directly addressed how LULCC affects patterns of Net Primary Productivity (NPP) and albedo. Moreover, defining the scope of these environmental and socioeconomic relationships remains a challenge.

As such, the goal of this study is to determine how land cover changes in recent years have driven ecosystem behavior, focusing on climate and carbon variables, and in turn, may have impacted or been related to economic and population growth patterns. We centered the analysis on the state of Mato Grosso (MT), Brazil, as a case study of forested areas facing increasing pressure from climate change, human demands, and anthropic influence.

MT is a Brazilian state with 903,202 km² located in the Midwest region characterized by three distinct biomes: the Brazilian Cerrado (Savannah), the Pantanal Wetlands, and the Amazon Rainforest. Of particular concern within the Amazon Rainforest is the phenomenon known as the Arc of Deforestation, which represents a pressured frontier of the legally designated forest boundary ([](doi:10.3390/su13042085)). Over recent years, there has been a notable loss and fragmentation of the state's natural vegetation, with cultivated areas encroaching upon these ecosystems. This trend underscores the significant pressure exerted by agricultural expansion in the region ([](doi:10.1080/01431161.2013.788798)).

As the foremost producer of soy, corn, cotton, and cattle in Brazil, MT's agribusiness holds significant economic value, as reflected in its Gross Domestic Product (GDP). Simultaneously, the state government has established ambitious goals for the year 2030, which encompass strategies of conservation, eradicating illegal deforestation, and restoring degraded land to mitigate emissions.

# Methods

We collected the environmental data of land cover, NPP, albedo and LST used in this study over MODIS products (MODIS Land Cover Type Yearly Global; Terra Net Primary Production Gap; MODIS Albedo Daily 500m; Terra Land Surface Temperature). The socioeconomic data of population, soy-planted area ('planted area'), and GDP were accessed through the Brazilian Institute of Geography and Statistics - IBGE, and the Brazilian National Supply Company - Coban - for soybean planted area, although the data covers the agricultural year from a period of July of the first year to June of the second year, we considered for analysis that this data, comprising all records, belongs to the second year.

First, there was a general analysis of land cover change over the period. Then, to compare the environmental data with the socioeconomic time series, a yearly and spatial mean was calculated. Finally, for population, considering the census results, the time series was completed based on the exponential growth theory. After having all normalized variables' time series, we conducted a correlation analysis ([](doi:10.1080/00031305.1994.10476010)) to verify the association between them over their common period (2001 and 2021).

# Results

@fig:land-cover-change illustrates the main results on land cover change through the Sankey plot, variables time series, and their correlation. In the change in land cover presented in Sankey's plot (a), the 'others' class was surprised, given its minimum percentage.

```{figure} CISP2024-Land-cover-change-agricultural-increase-figure.png
:name: fig:land-cover-change
:alt: Sankey plot and time series showing land cover change in Mato Grosso from 2001 to 2021

(a) Sankey plot of land cover change in Mato Grosso from 2001 to 2021, showing the flow from forested areas to grassland and cropland. (b) Mato Grosso normalized variables time series displaying forest area, grassland, cropland, albedo, NPP, LST, planted area, GDP, and population trends. (c) Pearson correlation matrix showing the relationships between all environmental and socioeconomic variables, with significant negative correlations between forest area and all other variables.
```

In [](#fig:land-cover-change) (a), we see that between 2001 and 2021, there was approximately a 7% reduction in forested areas, accompanied by a simultaneous 8% expansion in grasslands and more than 3% in croplands. When considering [](#fig:land-cover-change) (b), we also see a continuous increase in planted area, which from the data relates to more than twice in the period. The predominant land cover changes involved forested areas to grassland and cropland conversion.

In both time series analyses ([](#fig:land-cover-change) (b)) and correlation ([](#fig:land-cover-change) (c)), normalization was applied. The statistical method revealed significant negative correlations between forest area and environmental variables of albedo and NPP, as well as all economic variables of 'planted area', GDP, and population (ranging from -0.7 to -0.85). 'Planted area' shows high significance with GDP and population (0.95 and 0.97, respectively), and albedo (0.81), but a weaker correlation with NPP and LST (0.65 and 0.66 respectively). The increase in albedo is negatively correlated to forest area, indicating that the increased conversion of forest to pasturelands is strongly linked with a rise in albedo, while positively correlated to the other environmental variables (NPP and LST) and the economic ones.

# Discussion

These findings imply that expanding soy-planted areas in Mato Grosso can be a driver of increasing albedo, LST, and NPP while impacting a decrease in forest area and an increase in cropland. The positive correlation with albedo suggests that the expansion of cultivated land is linked to greater reflectivity, which is primarily due to a reduction in the absorption of solar radiation, affecting the partitioning of turbulent fluxes into sensible and latent heat, and limiting evapotranspiration ([](doi:10.1029/2018GL081625)). For LST, the positive correlation indicates that the increase in soy planted area is associated with higher temperatures, which can affect local climate and agricultural practices.

There is also a positive relationship between the expansion of soy-planted areas and NPP, which is interesting due to forest loss. The expansion of planted areas correlates with increased NPP across forest ecosystems, notably in elevated carbon dioxide conditions, attributed to heightened nitrogen uptake and efficiency ([](doi:10.1073/pnas.0706518104), [](doi:10.1073/pnas.0609448103)). A possible explanation for this may be attributed to the faster growth rates of the soybean plant, an annual pasture crop, compared with less productive native vegetation.

Our results align with the trends found in modeling studies, wherein LULCC has been globally found to increase local surface albedo ([](doi:10.1007/s00382-004-0392-2)). Still, the potential cooling effect is offset by a decrease in sensible heat fluxes ([](doi:10.1038/nclimate2196)) as evident in the removal of native forest cover. This disturbance of the Amazon affects climate on local and regional scales due to a disruption in circulation patterns in the dry season and an intensified hydrological cycle in the wet season ([](doi:10.1088/1748-9326/aa6fd6)).

In comparison to other LULCC monitoring studies examining the Amazon, we find that such increases in albedo and LST due to increased areas of cropland are reflected in [](doi:10.1016/j.gloplacha.2015.02.009) and [](doi:10.3390/rs12030525), with [](doi:10.1016/j.rse.2021.112585) highlighting that Brazil is one of the top three countries leading in land surface warming effect of global croplands. In contrast to this, [](doi:10.1088/1748-9326/ac6a6d) have shown that protected areas of Amazonian forest exert a cooling effect and serve to moderate the diurnal and seasonal temperature ranges on a local scale.

Other studies, while analyzing local climate and carbon sequestration, report that deforestation has significantly impacted and reduced rainfall, and increased areas of the Amazon and Cerrado biomes which experience a dry season ([](doi:10.1007/s00704-020-03435-6), [](doi:10.1002/fee.2124), [](doi:10.1111/gcb.16856), [](doi:10.1038/s41586-021-03629-6)). This may result in a feedback loop, with increases in Amazon forest NPP deficit over the recent years, reflecting an ecosystem struggling to recover from prolonged and individual droughts. We understand that the complex changing in the state's ecosystem affects the multiple variables differently, especially when we include three biomes in the analysis.

The intricate relationship between land cover changes, environmental factors, and socio-economic development in Mato Grosso was shown in GDP historical increase and population rise. Although agricultural expansion has brought assumed prosperity so far, farmers will be the ones to suffer the most with the current rates of deforestation themselves ([](doi:10.1007/s10668-016-9889-1), [](doi:10.3390/su13042085)), with impacts on the hydrological cycle and economic revenue, with a decrease in agriculture productivity and a larger outweigh of any local benefits in northern Mato Grosso ([](doi:10.1002/fee.2124), [](doi:10.1038/s41467-021-22840-7)). Besides, current efforts to control Amazonian deforestation are, in turn, increasing the pressure on Cerrado land, which highlights the need for a holistic approach to environmental policies in Brazil.
